import { toDoc, fromDoc } from "@/infrastructure/persistence/mongo-order-tracking-repository.js";
import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

describe("order-tracking mapper", () => {
  it("round-trips through toDoc/fromDoc", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW); t.assignDriver(D1, NOW);
    const back = fromDoc(toDoc(t));
    expect(back.orderId).toBe(OID);
    expect(back.customerId).toBe(CID);
    expect(back.driverId).toBe(D1);
    expect(back.status).toBe(TrackingStatus.CREATED);
  });
  it("maps a null driverId", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    expect(toDoc(t).driverId).toBeNull();
    expect(fromDoc(toDoc(t)).driverId).toBeNull();
  });
});
