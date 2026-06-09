import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");
const D2 = DriverId.of("018f4e1a-0ccc-7c3d-8e4f-5a6b7c8d9e0f");

const make = (driverId: DriverId | null = D1, status: TrackingStatus = TrackingStatus.CREATED) =>
  OrderTracking.fromPersistence({ orderId: OID, customerId: CID, driverId, status, createdAt: NOW, updatedAt: NOW });

describe("OrderTracking.authorize (room-join decision)", () => {
  it("admin may join any room", () => {
    expect(make().authorize(UserId.of("018f4e1a-0999-7c3d-8e4f-5a6b7c8d9e0f"), "admin")).toBe(true);
  });
  it("the owning customer may join", () => {
    expect(make().authorize(CID, "customer")).toBe(true);
  });
  it("a non-owning customer may NOT join", () => {
    expect(make().authorize(UserId.of("018f4e1a-0888-7c3d-8e4f-5a6b7c8d9e0f"), "customer")).toBe(false);
  });
  it("the assigned driver may join", () => {
    expect(make(D1).authorize(UserId.of(D1), "driver")).toBe(true);
  });
  it("a non-assigned driver may NOT join", () => {
    expect(make(D1).authorize(UserId.of(D2), "driver")).toBe(false);
  });
  it("any driver is denied when no driver is assigned yet", () => {
    expect(make(null).authorize(UserId.of(D1), "driver")).toBe(false);
  });
});

describe("OrderTracking.canEmitDriverSignal (location/pickup/complete guard)", () => {
  it("allows the assigned driver before completion", () => {
    expect(make(D1, TrackingStatus.IN_TRANSIT).canEmitDriverSignal(UserId.of(D1))).toBe(true);
  });
  it("rejects a non-assigned socket", () => {
    expect(make(D1).canEmitDriverSignal(UserId.of(D2))).toBe(false);
  });
  it("rejects after completion", () => {
    expect(make(D1, TrackingStatus.COMPLETED).canEmitDriverSignal(UserId.of(D1))).toBe(false);
  });
  it("rejects when no driver assigned", () => {
    expect(make(null).canEmitDriverSignal(UserId.of(D1))).toBe(false);
  });
});
