import request from "supertest";
import { bootstrap, type TrackingFixture } from "./helpers/bootstrap.js";
import { orderCreated, driverAssigned } from "./helpers/events.js";
import { waitFor } from "./helpers/wait-for.js";
import { MongoLocationRepository } from "../../src/infrastructure/persistence/mongo-location-repository.js";
import { Coordinates } from "../../src/domain/shared/coordinates.js";
import { OrderId, DriverId } from "../../src/domain/shared/ids.js";

const OID = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
const CID = "018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f";
const D1 = "018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f";
const STRANGER = "018f4e1a-0ddd-7c3d-8e4f-5a6b7c8d9e0f";
const ADMIN = "018f4e1a-0eee-7c3d-8e4f-5a6b7c8d9e0f";
const UNKNOWN = "018f4e1a-0fff-7c3d-8e4f-5a6b7c8d9e0f";

let fx: TrackingFixture;
beforeAll(async () => { fx = await bootstrap(); });
afterAll(async () => { await fx.stop(); });
beforeEach(async () => { await fx.resetAll(); });

async function projectAssignedOrder(): Promise<void> {
  await fx.publishEvent("order.created", orderCreated(OID, CID));
  await waitFor(async () => {
    const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
    return !!doc && doc.customerId === CID;
  }, 5000);
  await fx.publishEvent("dispatch.driver.assigned", driverAssigned(OID, D1));
  await waitFor(async () => {
    const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
    return !!doc && doc.driverId === D1 && doc.customerId === CID;
  }, 5000);
}

async function seedPoints(): Promise<void> {
  const repo = new MongoLocationRepository(fx.db);
  for (let i = 0; i < 3; i++) {
    await repo.record(
      OrderId.of(OID),
      DriverId.of(D1),
      Coordinates.of(14.5 + i / 100, 121.0, 5),
      new Date(Date.UTC(2026, 5, 9, 10, 0, i)),
    );
  }
}

const bearer = (userId: string, role: "customer" | "driver" | "admin"): string =>
  `Bearer ${fx.signUserJwt(userId, role)}`;

describe("HTTP read authz", () => {
  describe("GET /tracking/orders/:orderId/latest", () => {
    it("returns 200 for the owning customer", async () => {
      await projectAssignedOrder();
      await seedPoints();
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/latest`).set("Authorization", bearer(CID, "customer"));
      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe(OID);
      expect(res.body.lat).toBeCloseTo(14.52);
      expect(typeof res.body.lng).toBe("number");
      expect(typeof res.body.ts).toBe("string");
    });

    it("returns 200 for an admin", async () => {
      await projectAssignedOrder();
      await seedPoints();
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/latest`).set("Authorization", bearer(ADMIN, "admin"));
      expect(res.status).toBe(200);
    });

    it("returns 404 for a stranger customer (hides existence — same as an unknown order)", async () => {
      await projectAssignedOrder();
      await seedPoints();
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/latest`).set("Authorization", bearer(STRANGER, "customer"));
      expect(res.status).toBe(404);
    });

    it("returns 404 for an unknown order", async () => {
      const res = await request(fx.baseUrl).get(`/tracking/orders/${UNKNOWN}/latest`).set("Authorization", bearer(ADMIN, "admin"));
      expect(res.status).toBe(404);
    });

    it("returns 404 for a known order with no points", async () => {
      await projectAssignedOrder();
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/latest`).set("Authorization", bearer(CID, "customer"));
      expect(res.status).toBe(404);
    });
  });

  describe("GET /tracking/orders/:orderId/route", () => {
    it("returns 200 with oldest-first items + nextCursor for the assigned driver", async () => {
      await projectAssignedOrder();
      await seedPoints();
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/route?limit=2`).set("Authorization", bearer(D1, "driver"));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(new Date(res.body.items[0].ts).getTime()).toBeLessThan(new Date(res.body.items[1].ts).getTime());
      expect(res.body.nextCursor).not.toBeNull();
    });

    it("returns 404 for a stranger (hides existence — same as an unknown order)", async () => {
      await projectAssignedOrder();
      await seedPoints();
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/route`).set("Authorization", bearer(STRANGER, "customer"));
      expect(res.status).toBe(404);
    });
  });

  describe("authentication", () => {
    it("returns 401 with no bearer token", async () => {
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/latest`);
      expect(res.status).toBe(401);
    });

    it("returns 401 with an invalid bearer token", async () => {
      const res = await request(fx.baseUrl).get(`/tracking/orders/${OID}/latest`).set("Authorization", "Bearer garbage");
      expect(res.status).toBe(401);
    });
  });
});
