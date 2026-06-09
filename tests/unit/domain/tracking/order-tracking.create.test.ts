import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");

describe("OrderTracking.fromOrderCreated", () => {
  it("starts created with the customerId, no driver, no events", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    expect(t.orderId).toBe(OID);
    expect(t.customerId).toBe(CID);
    expect(t.driverId).toBeNull();
    expect(t.status).toBe(TrackingStatus.CREATED);
    expect(t.pullEvents()).toEqual([]);
  });

  it("round-trips through fromPersistence", () => {
    const did = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");
    const t = OrderTracking.fromPersistence({
      orderId: OID, customerId: CID, driverId: did,
      status: TrackingStatus.IN_TRANSIT, createdAt: NOW, updatedAt: NOW,
    });
    expect(t.driverId).toBe(did);
    expect(t.status).toBe(TrackingStatus.IN_TRANSIT);
  });
});
