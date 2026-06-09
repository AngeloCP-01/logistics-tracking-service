import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";
import { DeliveryInTransit } from "@/domain/events/index.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const LATER = new Date("2026-06-09T10:05:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

describe("OrderTracking.startDelivery", () => {
  it("moves created → in_transit and records DeliveryInTransit", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, NOW);
    const changed = t.startDelivery(LATER);
    expect(changed).toBe(true);
    expect(t.status).toBe(TrackingStatus.IN_TRANSIT);
    const events = t.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(DeliveryInTransit);
  });

  it("is a no-op (returns false, no event) when already in_transit", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, NOW);
    t.startDelivery(LATER);
    t.pullEvents();                                  // drain the first
    const changed = t.startDelivery(LATER);
    expect(changed).toBe(false);
    expect(t.pullEvents()).toEqual([]);
  });

  it("is a no-op when already completed", () => {
    const t = OrderTracking.fromPersistence({
      orderId: OID, customerId: CID, driverId: D1,
      status: TrackingStatus.COMPLETED, createdAt: NOW, updatedAt: NOW,
    });
    expect(t.startDelivery(LATER)).toBe(false);
    expect(t.pullEvents()).toEqual([]);
  });
});
