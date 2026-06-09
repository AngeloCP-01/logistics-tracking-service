import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";
import { DeliveryCompleted } from "@/domain/events/index.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const LATER = new Date("2026-06-09T10:05:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

describe("OrderTracking.completeDelivery", () => {
  it("moves in_transit → completed and records DeliveryCompleted", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, NOW);
    t.startDelivery(NOW);
    t.pullEvents();
    const changed = t.completeDelivery(LATER);
    expect(changed).toBe(true);
    expect(t.status).toBe(TrackingStatus.COMPLETED);
    const events = t.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(DeliveryCompleted);
  });

  it("completes directly from created (a complete without a prior pickup still settles)", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, NOW);
    expect(t.completeDelivery(LATER)).toBe(true);
    expect(t.status).toBe(TrackingStatus.COMPLETED);
  });

  it("is a no-op (returns false, no event) when already completed", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, NOW);
    t.completeDelivery(LATER);
    t.pullEvents();
    expect(t.completeDelivery(LATER)).toBe(false);
    expect(t.pullEvents()).toEqual([]);
  });
});
