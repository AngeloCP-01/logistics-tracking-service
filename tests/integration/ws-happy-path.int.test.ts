import { bootstrap, type TrackingFixture } from "./helpers/bootstrap.js";
import { collectEvents, type EventCollector, orderCreated, driverAssigned } from "./helpers/events.js";
import { connectSocket } from "./helpers/socket-client.js";
import { waitFor } from "./helpers/wait-for.js";

const OID = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
const CID = "018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f";
const DID = "018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f";
let fx: TrackingFixture;
let collector: EventCollector;
beforeAll(async () => { fx = await bootstrap(); });
afterAll(async () => { await fx.stop(); });
beforeEach(async () => { await fx.resetAll(); collector = await collectEvents(fx.rabbitUrl, ["delivery.in_transit", "delivery.completed"]); });
afterEach(async () => { await collector.stop(); });

describe("WS happy path", () => {
  it("projects the order, broadcasts a location to the customer, and publishes the lifecycle", async () => {
    // 1. Drive the projection.
    await fx.publishEvent("order.created", orderCreated(OID, CID));
    await fx.publishEvent("dispatch.driver.assigned", driverAssigned(OID, DID));
    await waitFor(async () => {
      const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
      return !!doc && doc.driverId === DID && doc.customerId === CID;
    }, 5000);

    // 2. Two sockets: driver (assigned) + customer (owner).
    const driver = await connectSocket(fx.baseUrl, fx.signUserJwt(DID, "driver"));
    const customer = await connectSocket(fx.baseUrl, fx.signUserJwt(CID, "customer"));
    await customer.joinRoom(OID);
    await driver.joinRoom(OID);

    // 3. Driver location → customer receives driver:location.
    const gotLocation = customer.once<{ orderId: string; lat: number; lng: number; ts: string }>("driver:location");
    driver.emit("location:update", { orderId: OID, lat: 14.55, lng: 121.02, accuracy: 5 });
    const loc = await gotLocation;
    expect(loc.orderId).toBe(OID);
    expect(loc.lat).toBeCloseTo(14.55);

    // 4. Pickup → delivery.in_transit envelope + customer delivery:in_transit.
    const gotInTransit = customer.once("delivery:in_transit");
    driver.emit("delivery:pickup", { orderId: OID });
    await gotInTransit;
    await waitFor(async () => collector.messages.some((m) => m.routingKey === "delivery.in_transit" && (m.data as { orderId: string }).orderId === OID), 5000);

    // 5. Complete → delivery.completed envelope.
    driver.emit("delivery:complete", { orderId: OID });
    await waitFor(async () => collector.messages.some((m) => m.routingKey === "delivery.completed" && (m.data as { orderId: string }).orderId === OID), 5000);

    // 6. On-join snapshot: a late customer joining now receives the last-known point immediately.
    const late = await connectSocket(fx.baseUrl, fx.signUserJwt(CID, "customer"));
    const snapshot = late.once<{ lat: number }>("driver:location");
    late.emit("room:join", { orderId: OID });
    const snap = await snapshot;
    expect(snap.lat).toBeCloseTo(14.55);

    driver.close(); customer.close(); late.close();
  });
});
