import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const LATER = new Date("2026-06-09T10:05:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");
const D2 = DriverId.of("018f4e1a-0ccc-7c3d-8e4f-5a6b7c8d9e0f");

describe("OrderTracking.assignDriver", () => {
  it("sets the driverId and bumps updatedAt", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, LATER);
    expect(t.driverId).toBe(D1);
    expect(t.updatedAt).toEqual(LATER);
  });
  it("overwrites the driverId on a reassignment (last assignment wins)", () => {
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, LATER);
    t.assignDriver(D2, LATER);
    expect(t.driverId).toBe(D2);
  });
});
