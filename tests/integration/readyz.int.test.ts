import request from "supertest";
import { bootstrap, type TrackingFixture } from "./helpers/bootstrap.js";

describe("readyz (integration)", () => {
  let fx: TrackingFixture;
  beforeAll(async () => { fx = await bootstrap({ startConsumer: false }); }, 120000);
  afterAll(async () => { if (fx) await fx.stop(); });

  it("returns 200 on /readyz when Mongo + channel + Redis are healthy", async () => {
    const res = await request(fx.baseUrl).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("returns 200 on /healthz", async () => {
    const res = await request(fx.baseUrl).get("/healthz");
    expect(res.status).toBe(200);
  });

  // The remaining cases are destructive (stopping a container / closing the channel
  // is irreversible, and setShuttingDown can't be undone) so they run last and in an
  // order that lets each `detail` surface despite readyz's short-circuit check order
  // (shuttingDown → mongo → channel → redis):
  //   redis-down  (mongo ok, channel ok) → redis_unavailable
  //   channel-closed (mongo ok)          → broker_unavailable
  //   mongo-down (checked first)         → mongo_unavailable
  //   shutting-down (checked first)      → shutting_down

  it("returns 503 redis_unavailable when Redis is stopped", async () => {
    await fx.redisContainer.stop();
    const res = await request(fx.baseUrl).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
    expect(res.body.detail).toBe("redis_unavailable");
  }, 30000);

  it("returns 503 broker_unavailable when the RabbitMQ channel is closed", async () => {
    await fx.closeChannel();
    const res = await request(fx.baseUrl).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe("broker_unavailable");
  }, 30000);

  it("returns 503 mongo_unavailable when Mongo is stopped", async () => {
    await fx.mongo.container.stop();
    const res = await request(fx.baseUrl).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe("mongo_unavailable");
  }, 30000);

  it("returns 503 shutting_down while shutting down", async () => {
    fx.setShuttingDown();
    const res = await request(fx.baseUrl).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe("shutting_down");
  });

  it("returns 200 on /healthz even when dependencies are down", async () => {
    const res = await request(fx.baseUrl).get("/healthz");
    expect(res.status).toBe(200);
  });
});
