import { bootstrap, type TrackingFixture } from "./helpers/bootstrap.js";
import { orderCreated, driverAssigned } from "./helpers/events.js";
import { waitFor } from "./helpers/wait-for.js";

const OID = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
const CID = "018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f";
const D1 = "018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

let fx: TrackingFixture;
beforeAll(async () => { fx = await bootstrap(); });
afterAll(async () => { await fx.stop(); });
beforeEach(async () => { await fx.resetAll(); });

describe("tracking events consumer", () => {
  it("is idempotent for a repeated order.created (same eventId)", async () => {
    const ev = orderCreated(OID, CID); // a single envelope object with one fixed eventId
    const eventId = (ev as { eventId: string }).eventId;

    await fx.publishEvent("order.created", ev);
    await waitFor(async () => (await fx.db.collection("tracking_orders").countDocuments({ orderId: OID })) === 1, 5000);

    // Publish the very same envelope again.
    await fx.publishEvent("order.created", ev);
    // Give the consumer time to (re)process and dedupe.
    await new Promise((r) => setTimeout(r, 500));

    expect(await fx.db.collection("tracking_orders").countDocuments({ orderId: OID })).toBe(1);
    expect(await fx.db.collection("processed_events").countDocuments({ eventId })).toBe(1);
  });

  it("handles dispatch.driver.assigned arriving before order.created (placeholder then reconcile)", async () => {
    // Assigned arrives first: a doc is created with the driver + a placeholder customer.
    await fx.publishEvent("dispatch.driver.assigned", driverAssigned(OID, D1));
    await waitFor(async () => {
      const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
      return !!doc && doc.driverId === D1 && doc.customerId === PLACEHOLDER;
    }, 5000);

    // Now the matching order.created arrives: the SAME doc keeps the driver and gets the real customer.
    await fx.publishEvent("order.created", orderCreated(OID, CID));
    await waitFor(async () => {
      const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
      return !!doc && doc.driverId === D1 && doc.customerId === CID;
    }, 5000);

    expect(await fx.db.collection("tracking_orders").countDocuments({ orderId: OID })).toBe(1);
  });

  it("is idempotent for a repeated dispatch.driver.assigned (same eventId)", async () => {
    // Seed the order first so the assigned handler reconciles an existing doc.
    await fx.publishEvent("order.created", orderCreated(OID, CID));
    await waitFor(async () => {
      const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
      return !!doc && doc.customerId === CID;
    }, 5000);

    const ev = driverAssigned(OID, D1);
    const eventId = (ev as { eventId: string }).eventId;

    await fx.publishEvent("dispatch.driver.assigned", ev);
    await waitFor(async () => {
      const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
      return doc?.driverId === D1;
    }, 5000);

    await fx.publishEvent("dispatch.driver.assigned", ev);
    await new Promise((r) => setTimeout(r, 500));

    const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
    expect(doc?.driverId).toBe(D1);
    expect(doc?.customerId).toBe(CID);
    expect(await fx.db.collection("processed_events").countDocuments({ eventId })).toBe(1);
  });
});
