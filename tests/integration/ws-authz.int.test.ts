import { bootstrap, type TrackingFixture } from "./helpers/bootstrap.js";
import { collectEvents, type EventCollector, orderCreated, driverAssigned } from "./helpers/events.js";
import { connectSocket, type TestSocket } from "./helpers/socket-client.js";
import { waitFor } from "./helpers/wait-for.js";

const OID = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
const CID = "018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f";
const D1 = "018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f"; // the assigned driver
const D2 = "018f4e1a-0ccc-7c3d-8e4f-5a6b7c8d9e0f"; // some other, non-assigned driver
const STRANGER = "018f4e1a-0ddd-7c3d-8e4f-5a6b7c8d9e0f";
const ADMIN = "018f4e1a-0eee-7c3d-8e4f-5a6b7c8d9e0f";

let fx: TrackingFixture;
let collector: EventCollector;

beforeAll(async () => { fx = await bootstrap(); });
afterAll(async () => { await fx.stop(); });
beforeEach(async () => {
  await fx.resetAll();
  collector = await collectEvents(fx.rabbitUrl, ["delivery.in_transit", "delivery.completed"]);
  // Drive the projection: order created, then (once it lands) driver D1 assigned.
  // Serialize the two publishes so the projection doc settles with the real
  // customer before the driver is layered on (the consumer's prefetch allows
  // concurrent processing, so publishing both at once can race on the upsert).
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
});
afterEach(async () => { await collector.stop(); });

/** Race the socket `error` event against a timeout; resolves only on the expected code. */
function expectError(s: TestSocket, code: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`expected error ${code}, none received`)), 1000);
    s.socket.once("error", (e: { code: string }) => {
      clearTimeout(timer);
      if (e.code === code) resolve();
      else reject(new Error(`got ${e.code}`));
    });
  });
}

/** Resolves true if NO error arrives within the window (used for an allowed action). */
function expectNoError(s: TestSocket, ms = 400): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    s.socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

describe("WS authz matrix", () => {
  it("rejects an unauthenticated handshake", async () => {
    await expect(connectSocket(fx.baseUrl, "garbage")).rejects.toBeDefined();
  });

  it("denies a customer who does not own the order", async () => {
    const stranger = await connectSocket(fx.baseUrl, fx.signUserJwt(STRANGER, "customer"));
    const err = expectError(stranger, "forbidden");
    stranger.emit("room:join", { orderId: OID });
    await err;
    stranger.close();
  });

  it("denies a driver who is not the assigned driver", async () => {
    const other = await connectSocket(fx.baseUrl, fx.signUserJwt(D2, "driver"));
    const err = expectError(other, "forbidden");
    other.emit("room:join", { orderId: OID });
    await err;
    other.close();
  });

  it("allows an admin to join any order's room", async () => {
    const admin = await connectSocket(fx.baseUrl, fx.signUserJwt(ADMIN, "admin"));
    const noError = expectNoError(admin);
    admin.emit("room:join", { orderId: OID });
    expect(await noError).toBe(true);
    admin.close();
  });

  it("rejects an untrusted location:update from a non-assigned driver (no point, no broadcast)", async () => {
    // Owner customer in the room to prove nothing is broadcast to them.
    const customer = await connectSocket(fx.baseUrl, fx.signUserJwt(CID, "customer"));
    await customer.joinRoom(OID);
    let leaked = false;
    customer.socket.on("driver:location", () => { leaked = true; });

    const other = await connectSocket(fx.baseUrl, fx.signUserJwt(D2, "driver"));
    const err = expectError(other, "forbidden");
    other.emit("location:update", { orderId: OID, lat: 14.6, lng: 121.0, accuracy: 5 });
    await err;

    // Give any (erroneous) broadcast a beat to arrive, then assert nothing landed/persisted.
    await new Promise((r) => setTimeout(r, 300));
    expect(leaked).toBe(false);
    const points = await fx.db.collection("driver_locations").countDocuments({ "meta.orderId": OID });
    expect(points).toBe(0);

    customer.close(); other.close();
  });

  it("rejects a lifecycle signal from a non-assigned driver (no envelope, status unchanged)", async () => {
    const other = await connectSocket(fx.baseUrl, fx.signUserJwt(D2, "driver"));
    const err = expectError(other, "forbidden");
    other.emit("delivery:pickup", { orderId: OID });
    await err;

    await new Promise((r) => setTimeout(r, 300));
    expect(collector.messages.some((m) => m.routingKey === "delivery.in_transit")).toBe(false);
    const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
    expect(doc?.status).toBe("created");

    other.close();
  });

  it("rejects driver signals after the delivery is completed", async () => {
    const driver = await connectSocket(fx.baseUrl, fx.signUserJwt(D1, "driver"));
    // Complete the delivery first (D1 is the assigned driver).
    driver.emit("delivery:pickup", { orderId: OID });
    await waitFor(async () => collector.messages.some((m) => m.routingKey === "delivery.in_transit"), 5000);
    driver.emit("delivery:complete", { orderId: OID });
    await waitFor(async () => {
      const doc = await fx.db.collection("tracking_orders").findOne({ orderId: OID });
      return doc?.status === "completed";
    }, 5000);

    // Now a post-completion signal must be rejected (the §8 already-completed guard).
    const err = expectError(driver, "forbidden");
    driver.emit("location:update", { orderId: OID, lat: 14.7, lng: 121.1, accuracy: 5 });
    await err;

    driver.close();
  });
});
