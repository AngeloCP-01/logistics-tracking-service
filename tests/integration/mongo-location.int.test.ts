import { bootstrap, type TrackingFixture } from "./helpers/bootstrap.js";
import { MongoLocationRepository } from "../../src/infrastructure/persistence/mongo-location-repository.js";
import { LOCATIONS } from "../../src/infrastructure/persistence/mongo-bootstrap.js";
import { Coordinates } from "../../src/domain/shared/coordinates.js";
import { OrderId, DriverId } from "../../src/domain/shared/ids.js";

const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");
let fx: TrackingFixture;
let repo: MongoLocationRepository;
beforeAll(async () => { fx = await bootstrap({ startConsumer: false }); repo = new MongoLocationRepository(fx.db); });
afterAll(async () => { await fx.stop(); });
beforeEach(async () => { await fx.resetAll(); });

describe("MongoLocationRepository (time-series)", () => {
  it("created driver_locations as a time-series collection with a TTL", async () => {
    const colls = await fx.db.listCollections({ name: LOCATIONS }).toArray();
    expect(colls).toHaveLength(1);
    const info = colls[0] as {
      type?: string;
      options?: { expireAfterSeconds?: number; timeseries?: { timeField?: string; metaField?: string } };
    };
    expect(info.type).toBe("timeseries");
    expect(info.options?.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
    expect(info.options?.timeseries?.timeField).toBe("ts");
    expect(info.options?.timeseries?.metaField).toBe("meta");
  });

  it("created a 2dsphere index on the point field", async () => {
    const indexes = await fx.db.collection(LOCATIONS).indexes();
    const geo = indexes.find((i) => Object.values(i.key).includes("2dsphere"));
    expect(geo).toBeDefined();
  });

  it("records points and returns the newest as latest", async () => {
    await repo.record(OID, D1, Coordinates.of(14.50, 121.00), new Date("2026-06-09T10:00:00Z"));
    await repo.record(OID, D1, Coordinates.of(14.51, 121.01), new Date("2026-06-09T10:00:03Z"));
    const latest = await repo.latest(OID);
    expect(latest).not.toBeNull();
    expect(latest!.lat).toBeCloseTo(14.51);
    expect(latest!.ts.toISOString()).toBe("2026-06-09T10:00:03.000Z");
  });

  it("returns the breadcrumb oldest-first with cursor pagination", async () => {
    for (let i = 0; i < 3; i++) await repo.record(OID, D1, Coordinates.of(14.5 + i / 100, 121.0), new Date(Date.UTC(2026, 5, 9, 10, 0, i)));
    const page1 = await repo.route(OID, 2, null);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].ts.getTime()).toBeLessThan(page1.items[1].ts.getTime());
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.route(OID, 2, page1.nextCursor);
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it("latest returns null for an order with no points", async () => {
    expect(await repo.latest(OID)).toBeNull();
  });
});
