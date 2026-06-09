import http from "node:http";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./infrastructure/logger.js";
import { SystemClock } from "./infrastructure/clock/system-clock.js";
import { createMongo } from "./infrastructure/persistence/mongo-client.js";
import { bootstrapMongo } from "./infrastructure/persistence/mongo-bootstrap.js";
import { MongoLocationRepository } from "./infrastructure/persistence/mongo-location-repository.js";
import { MongoOrderTrackingRepository } from "./infrastructure/persistence/mongo-order-tracking-repository.js";
import { MongoProcessedEventRepository } from "./infrastructure/persistence/mongo-processed-event-repository.js";
import { createRedisClient } from "./infrastructure/redis/redis-client.js";
import { createSocketServer } from "./infrastructure/ws/socket-io-server.js";
import { connect, assertTrackingTopology } from "./infrastructure/messaging/rabbitmq-connection.js";
import { RabbitMqEventPublisher } from "./infrastructure/messaging/rabbitmq-event-publisher.js";
import { UserJwtVerifier } from "./infrastructure/auth/user-jwt-verifier.js";
import { HandleOrderCreatedUseCase } from "./application/tracking/handle-order-created.use-case.js";
import { HandleDriverAssignedUseCase } from "./application/tracking/handle-driver-assigned.use-case.js";
import { RecordLocationUseCase } from "./application/tracking/record-location.use-case.js";
import { StartDeliveryUseCase } from "./application/tracking/start-delivery.use-case.js";
import { CompleteDeliveryUseCase } from "./application/tracking/complete-delivery.use-case.js";
import { AuthorizeJoinUseCase } from "./application/tracking/authorize-join.use-case.js";
import { GetLatestUseCase } from "./application/tracking/get-latest.use-case.js";
import { GetRouteUseCase } from "./application/tracking/get-route.use-case.js";
import { TrackingReadController } from "./interfaces/http/controllers/tracking-read-controller.js";
import { HealthController } from "./interfaces/http/controllers/health-controller.js";
import { registerWsHandlers } from "./interfaces/ws/register-ws-handlers.js";
import { startTrackingEventsConsumer } from "./interfaces/events/tracking-events-consumer.js";
import { createApp } from "./app.js";

/**
 * A boot-time failure attributed to a specific dependency/config, so the log
 * names WHAT failed (Mongo? Redis? RabbitMQ? the port?) and how to fix it —
 * instead of surfacing a raw driver message like "403 ACCESS-REFUSED" with no
 * context.
 */
class BootError extends Error {
  constructor(
    readonly dependency: string,
    readonly envVar: string | null,
    readonly hint: string | null,
    cause: unknown,
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to ${dependency}${envVar ? ` (check ${envVar})` : ""}: ${causeMsg}` +
        (hint ? ` — ${hint}` : ""),
    );
    this.name = "BootError";
  }
}

async function bootStep<T>(
  meta: { what: string; envVar?: string; hint?: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new BootError(meta.what, meta.envVar ?? null, meta.hint ?? null, cause);
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "--healthcheck") {
    process.stdout.write(JSON.stringify({ ok: true, service: "tracking-service" }) + "\n");
    process.exit(0);
  }
  const env = loadEnv();
  const logger = createLogger(env);
  const clock = new SystemClock();

  const { client: mongoClient, db } = await bootStep(
    {
      what: "connect to MongoDB",
      envVar: "TRACKING_MONGO_URL",
      hint: "is the database reachable and the URL/credentials correct?",
    },
    () => createMongo(env.TRACKING_MONGO_URL),
  );
  await bootStep(
    { what: "bootstrap MongoDB collections + indexes", envVar: "TRACKING_MONGO_URL" },
    () => bootstrapMongo(db, env.TRACKING_LOCATION_TTL_DAYS),
  );

  // App health-Redis (fail-fast ping) + the two Socket.IO adapter clients.
  const redis = createRedisClient(env.REDIS_URL);
  await bootStep(
    { what: "connect to Redis", envVar: "REDIS_URL", hint: "is Redis reachable?" },
    () => redis.connect().then(() => redis.ping()),
  );
  const pub = createRedisClient(env.REDIS_URL);
  const sub = pub.duplicate();
  await bootStep(
    { what: "connect Redis pub/sub for the Socket.IO adapter", envVar: "REDIS_URL" },
    () => Promise.all([pub.connect(), sub.connect()]),
  );

  const { connection, channel } = await bootStep(
    {
      what: "connect to RabbitMQ",
      envVar: "RABBITMQ_URL",
      hint: "is the broker running and credentials right? (platform logistics-rabbitmq uses dev/dev)",
    },
    () => connect(env.RABBITMQ_URL),
  );
  await bootStep(
    { what: "assert RabbitMQ topology", envVar: "RABBITMQ_URL" },
    () => assertTrackingTopology(channel),
  );

  // Repos + publisher.
  const locations = new MongoLocationRepository(db);
  const trackingRepo = new MongoOrderTrackingRepository(db);
  const processed = new MongoProcessedEventRepository(db);
  const publisher = new RabbitMqEventPublisher(channel);

  // Use-cases.
  const handleOrderCreated = new HandleOrderCreatedUseCase(trackingRepo, processed, clock);
  const handleDriverAssigned = new HandleDriverAssignedUseCase(trackingRepo, processed, clock);
  const recordLocation = new RecordLocationUseCase(trackingRepo, locations, clock);
  const startDelivery = new StartDeliveryUseCase(trackingRepo, publisher, clock);
  const completeDelivery = new CompleteDeliveryUseCase(trackingRepo, publisher, clock);
  const authorizeJoin = new AuthorizeJoinUseCase(trackingRepo);
  const getLatest = new GetLatestUseCase(trackingRepo, locations);
  const getRoute = new GetRouteUseCase(trackingRepo, locations);

  // HTTP app + health.
  let activeChannel: typeof channel | null = channel;
  channel.on("close", () => {
    activeChannel = null;
  });
  let shuttingDown = false;
  const userJwt = new UserJwtVerifier(env.JWT_SECRET);
  const controller = new TrackingReadController(getLatest, getRoute);
  const health = new HealthController(db, () => activeChannel, () => shuttingDown, redis);
  const app = createApp({ logger, health, userJwt, controller });

  // HTTP server + Socket.IO attached to it.
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

  const consumer = await bootStep(
    { what: "start the tracking events consumer", envVar: "RABBITMQ_URL" },
    () => startTrackingEventsConsumer({ channel, logger, handleOrderCreated, handleDriverAssigned }),
  );

  await bootStep(
    { what: "bind the HTTP server", envVar: "PORT", hint: "is the port already in use?" },
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(env.PORT, () => {
          server.off("error", reject);
          resolve();
        });
      }),
  );
  logger.info({ event: "listening", port: env.PORT });

  const shutdown = async (signal: string): Promise<void> => {
    shuttingDown = true;
    logger.info({ event: "shutdown_started", signal });
    try {
      await consumer.stop();
      activeChannel = null;
      await socket.close();
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
    } catch (e) {
      logger.warn({ event: "shutdown_close_failed", err: e });
    }
    await Promise.all([redis.quit(), pub.quit(), sub.quit()].map((p) => p.catch(() => undefined)));
    server.close(async () => {
      await mongoClient.close().catch(() => undefined);
      logger.info({ event: "shutdown_complete" });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  const isBoot = err instanceof BootError;
  process.stderr.write(
    JSON.stringify({
      level: "error",
      event: "boot_failed",
      dependency: isBoot ? err.dependency : undefined,
      configHint: isBoot ? err.envVar ?? undefined : undefined,
      message: err instanceof Error ? err.message : String(err),
    }) + "\n",
  );
  process.exit(1);
});
