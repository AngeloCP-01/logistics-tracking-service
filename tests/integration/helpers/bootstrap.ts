import http, { type Server } from "node:http";
import jwt from "jsonwebtoken";
const { sign } = jwt;
import pino from "pino";
import type { Db } from "mongodb";
import { startMongo, stopMongo, type MongoFixture } from "./mongo-container.js";
import { startRabbit, stopRabbit, type RabbitFixture } from "./rabbitmq-container.js";
import { startRedis } from "./redis-container.js";
import type { StartedRedisContainer } from "@testcontainers/redis";

import { createMongo } from "../../../src/infrastructure/persistence/mongo-client.js";
import {
  bootstrapMongo,
  LOCATIONS,
  TRACKING_ORDERS,
  PROCESSED_EVENTS,
} from "../../../src/infrastructure/persistence/mongo-bootstrap.js";
import { MongoLocationRepository } from "../../../src/infrastructure/persistence/mongo-location-repository.js";
import { MongoOrderTrackingRepository } from "../../../src/infrastructure/persistence/mongo-order-tracking-repository.js";
import { MongoProcessedEventRepository } from "../../../src/infrastructure/persistence/mongo-processed-event-repository.js";
import { createRedisClient } from "../../../src/infrastructure/redis/redis-client.js";
import { createSocketServer } from "../../../src/infrastructure/ws/socket-io-server.js";
import {
  connect,
  assertTrackingTopology,
  LOGISTICS_EXCHANGE,
  TRACKING_EVENTS_QUEUE,
} from "../../../src/infrastructure/messaging/rabbitmq-connection.js";
import { RabbitMqEventPublisher } from "../../../src/infrastructure/messaging/rabbitmq-event-publisher.js";
import { UserJwtVerifier } from "../../../src/infrastructure/auth/user-jwt-verifier.js";
import { SystemClock } from "../../../src/infrastructure/clock/system-clock.js";
import { HandleOrderCreatedUseCase } from "../../../src/application/tracking/handle-order-created.use-case.js";
import { HandleDriverAssignedUseCase } from "../../../src/application/tracking/handle-driver-assigned.use-case.js";
import { RecordLocationUseCase } from "../../../src/application/tracking/record-location.use-case.js";
import { StartDeliveryUseCase } from "../../../src/application/tracking/start-delivery.use-case.js";
import { CompleteDeliveryUseCase } from "../../../src/application/tracking/complete-delivery.use-case.js";
import { AuthorizeJoinUseCase } from "../../../src/application/tracking/authorize-join.use-case.js";
import { GetLatestUseCase } from "../../../src/application/tracking/get-latest.use-case.js";
import { GetRouteUseCase } from "../../../src/application/tracking/get-route.use-case.js";
import { TrackingReadController } from "../../../src/interfaces/http/controllers/tracking-read-controller.js";
import { HealthController } from "../../../src/interfaces/http/controllers/health-controller.js";
import { registerWsHandlers } from "../../../src/interfaces/ws/register-ws-handlers.js";
import { startTrackingEventsConsumer } from "../../../src/interfaces/events/tracking-events-consumer.js";
import { createApp } from "../../../src/app.js";

const USER_SECRET = "u".repeat(40);
const TTL_DAYS = 30;

/** Bounds a teardown close so a dead dependency (stopped container) can't hang `stop()`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())]);
}

export interface TrackingFixture {
  mongo: MongoFixture;
  rabbit: RabbitFixture;
  redisContainer: StartedRedisContainer;
  server: Server;
  port: number;
  baseUrl: string;
  db: Db;
  rabbitUrl: string;
  stop: () => Promise<void>;
  setShuttingDown: () => void;
  closeChannel: () => Promise<void>;
  signUserJwt: (userId: string, role: "customer" | "driver" | "admin") => string;
  publishEvent: (routingKey: string, envelope: unknown) => Promise<void>;
  resetAll: () => Promise<void>;
}

export async function bootstrap(opts?: { startConsumer?: boolean }): Promise<TrackingFixture> {
  const mongo = await startMongo();
  const rabbit = await startRabbit();
  const redisFx = await startRedis();

  const logger = pino({ level: "silent" });
  const clock = new SystemClock();

  const { client: mongoClient, db } = await createMongo(mongo.url);
  await bootstrapMongo(db, TTL_DAYS);

  // App health-Redis (fail-fast ping) + the two Socket.IO adapter clients.
  // Attach 'error' handlers so that when a readyz dependency-down probe stops the
  // Redis container, the clients' retry-exhaustion errors are tolerated rather than
  // crashing the test process as unhandled 'error' events.
  const redis = createRedisClient(redisFx.url);
  redis.on("error", () => { /* tolerated in tests */ });
  await redis.connect();
  await redis.ping();
  // The Socket.IO adapter clients use maxRetriesPerRequest: null so that when a
  // readyz dependency-down probe stops the Redis container, the adapter's in-flight
  // commands queue (and never settle) instead of rejecting with an unhandled
  // MaxRetriesPerRequestError that would crash the test run. (The health-Redis above
  // keeps maxRetriesPerRequest: 1 so its ping fails fast — that's what readyz tests.)
  const pub = createRedisClient(redisFx.url, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  pub.on("error", () => { /* tolerated in tests */ });
  sub.on("error", () => { /* tolerated in tests */ });
  await Promise.all([pub.connect(), sub.connect()]);

  const { connection: amqpConn, channel: amqpCh } = await connect(rabbit.url);
  await assertTrackingTopology(amqpCh);
  let activeChannel: typeof amqpCh | null = amqpCh;
  amqpCh.on("close", () => { activeChannel = null; });
  // Tolerate heartbeat/connection errors that fire after the broker container is
  // killed mid-test (readyz-down probes etc.).
  amqpCh.on("error", () => { /* tolerated in tests */ });
  amqpConn.on("error", () => { /* tolerated in tests */ });

  // An independent channel for the test to publish onto the exchange (mirrors a
  // real producer; the consumer is bound to TRACKING_EVENTS_QUEUE).
  const pubChannel = await amqpConn.createChannel();
  await pubChannel.assertExchange(LOGISTICS_EXCHANGE, "topic", { durable: true });

  // Repos + publisher.
  const locations = new MongoLocationRepository(db);
  const trackingRepo = new MongoOrderTrackingRepository(db);
  const processed = new MongoProcessedEventRepository(db);
  const publisher = new RabbitMqEventPublisher(amqpCh);

  // Use-cases (same constructor args as server.ts).
  const handleOrderCreated = new HandleOrderCreatedUseCase(trackingRepo, processed, clock);
  const handleDriverAssigned = new HandleDriverAssignedUseCase(trackingRepo, processed, clock);
  const recordLocation = new RecordLocationUseCase(trackingRepo, locations, clock);
  const startDelivery = new StartDeliveryUseCase(trackingRepo, publisher, clock);
  const completeDelivery = new CompleteDeliveryUseCase(trackingRepo, publisher, clock);
  const authorizeJoin = new AuthorizeJoinUseCase(trackingRepo);
  const getLatest = new GetLatestUseCase(trackingRepo, locations);
  const getRoute = new GetRouteUseCase(trackingRepo, locations);

  let shuttingDown = false;
  const userJwt = new UserJwtVerifier(USER_SECRET);
  const controller = new TrackingReadController(getLatest, getRoute);
  const health = new HealthController(db, () => activeChannel, () => shuttingDown, redis);
  const app = createApp({ logger, health, userJwt, controller });

  const server = http.createServer(app);
  const socket = createSocketServer(server, pub, sub);
  registerWsHandlers({
    io: socket.io,
    logger,
    userJwt,
    authorizeJoin,
    recordLocation,
    startDelivery,
    completeDelivery,
    getLatest,
    tracking: trackingRepo,
  });

  let consumer: { stop: () => Promise<void> } | null = null;
  if (opts?.startConsumer ?? true) {
    consumer = await startTrackingEventsConsumer({ channel: amqpCh, logger, handleOrderCreated, handleDriverAssigned });
  }

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    mongo,
    rabbit,
    redisContainer: redisFx.container,
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    rabbitUrl: rabbit.url,
    stop: async () => {
      shuttingDown = true;
      try { if (consumer) await consumer.stop(); } catch { /* ignore */ }
      // Close the Socket.IO server FIRST, while the adapter's Redis clients are still
      // connected, so it can cleanly unsubscribe. withTimeout bounds it for the readyz
      // case where Redis is already dead (the unsubscribe then throws "Connection is
      // closed" synchronously — caught here — rather than hanging).
      try { await withTimeout(socket.close(), 5000); } catch { /* ignore */ }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // disconnect() (not quit()) so teardown can't hang on a dead Redis — the readyz
      // dependency-down probes may have stopped the container, and quit() would block
      // forever on the queued/un-settleable command.
      try { redis.disconnect(); } catch { /* ignore */ }
      try { pub.disconnect(); } catch { /* ignore */ }
      try { sub.disconnect(); } catch { /* ignore */ }
      try { await withTimeout(pubChannel.close(), 5000); } catch { /* ignore */ }
      try { await withTimeout(amqpCh.close(), 5000); } catch { /* ignore */ }
      try { await withTimeout(amqpConn.close(), 5000); } catch { /* ignore */ }
      try { await withTimeout(mongoClient.close(), 5000); } catch { /* ignore */ }
      try { await redisFx.stop(); } catch { /* ignore */ }
      try { await stopRabbit(rabbit); } catch { /* ignore */ }
      try { await stopMongo(mongo); } catch { /* ignore */ }
    },
    setShuttingDown: () => { shuttingDown = true; },
    closeChannel: async () => {
      // Closing the work channel flips activeChannel → null via its "close" handler,
      // so readyz reports broker_unavailable. The consumer's channel is the same one.
      activeChannel = null;
      try { await amqpCh.close(); } catch { /* ignore */ }
    },
    signUserJwt: (userId, role) => sign({ role }, USER_SECRET, { algorithm: "HS256", subject: userId, expiresIn: "5m" }),
    publishEvent: async (routingKey, envelope) => {
      pubChannel.publish(LOGISTICS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(envelope)), {
        contentType: "application/json",
        persistent: true,
      });
    },
    resetAll: async () => {
      await db.collection(LOCATIONS).drop().catch(() => undefined);
      await db.collection(TRACKING_ORDERS).drop().catch(() => undefined);
      await db.collection(PROCESSED_EVENTS).drop().catch(() => undefined);
      await bootstrapMongo(db, TTL_DAYS);
      try { await amqpCh.purgeQueue(TRACKING_EVENTS_QUEUE); } catch { /* ignore */ }
    },
  };
}
