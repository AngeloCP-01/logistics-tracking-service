import { envSchema } from "@/config/env.schema.js";

const base = {
  NODE_ENV: "test", PORT: "3005", LOG_LEVEL: "info", LOG_SERVICE_NAME: "tracking-service",
  TRACKING_MONGO_URL: "mongodb://localhost:27018/tracking",
  REDIS_URL: "redis://localhost:6380",
  RABBITMQ_URL: "amqp://dev:dev@localhost:5672",
  JWT_SECRET: "a".repeat(32),
  TRACKING_LOCATION_TTL_DAYS: "30",
};

describe("envSchema", () => {
  it("parses a valid env and coerces numbers", () => {
    const env = envSchema.parse(base);
    expect(env.PORT).toBe(3005);
    expect(env.TRACKING_LOCATION_TTL_DAYS).toBe(30);
  });

  it("defaults TTL days to 30 when omitted", () => {
    const { TRACKING_LOCATION_TTL_DAYS: _omit, ...rest } = base;
    expect(envSchema.parse(rest).TRACKING_LOCATION_TTL_DAYS).toBe(30);
  });

  it("rejects a short JWT_SECRET", () => {
    expect(() => envSchema.parse({ ...base, JWT_SECRET: "short" })).toThrow();
  });

  it("rejects a non-mongodb url", () => {
    expect(() => envSchema.parse({ ...base, TRACKING_MONGO_URL: "http://nope" })).toThrow();
  });
});
