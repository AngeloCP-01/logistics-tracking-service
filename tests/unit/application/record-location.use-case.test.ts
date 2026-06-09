import { RecordLocationUseCase } from "@/application/tracking/record-location.use-case.js";
import { FakeOrderTrackingRepo, FakeLocationRepo, FixedClock } from "./_fakes.js";
import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { Coordinates } from "@/domain/shared/coordinates.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";
import { OrderTrackingNotFoundError } from "@/domain/shared/errors.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

function build() {
  const tracking = new FakeOrderTrackingRepo();
  const locations = new FakeLocationRepo();
  const uc = new RecordLocationUseCase(tracking, locations, new FixedClock(NOW));
  return { tracking, locations, uc };
}

describe("RecordLocationUseCase", () => {
  it("persists the point and returns the stored coords + ts", async () => {
    const { tracking, locations, uc } = build();
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
    t.assignDriver(D1, NOW);
    await tracking.save(t);
    const out = await uc.execute({ orderId: OID, driverId: D1, coords: Coordinates.of(14.5, 121.0) }, "corr");
    expect(out).toEqual({ orderId: OID, lat: 14.5, lng: 121.0, ts: NOW });
    expect(locations.points).toHaveLength(1);
  });

  it("throws when the order is unknown", async () => {
    const { uc } = build();
    await expect(uc.execute({ orderId: OID, driverId: D1, coords: Coordinates.of(14.5, 121.0) }, "corr"))
      .rejects.toBeInstanceOf(OrderTrackingNotFoundError);
  });
});
