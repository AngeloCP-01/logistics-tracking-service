import { GetLatestUseCase } from "@/application/tracking/get-latest.use-case.js";
import { GetRouteUseCase } from "@/application/tracking/get-route.use-case.js";
import { FakeOrderTrackingRepo, FakeLocationRepo } from "./_fakes.js";
import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { Coordinates } from "@/domain/shared/coordinates.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";
import { OrderTrackingNotFoundError } from "@/domain/shared/errors.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

async function seed() {
  const tracking = new FakeOrderTrackingRepo();
  const locations = new FakeLocationRepo();
  const t = OrderTracking.fromOrderCreated(OID, CID, NOW); t.assignDriver(D1, NOW);
  await tracking.save(t);
  await locations.record(OID, D1, Coordinates.of(14.5, 121.0), NOW);
  return { tracking, locations };
}

describe("GetLatestUseCase", () => {
  it("returns the latest point to the owner", async () => {
    const { tracking, locations } = await seed();
    const uc = new GetLatestUseCase(tracking, locations);
    const out = await uc.execute(OID, CID as unknown as string, "customer");
    expect(out).toEqual({ orderId: OID, lat: 14.5, lng: 121.0, ts: NOW });
  });
  it("404s a stranger (hides existence — same as an unknown order)", async () => {
    const { tracking, locations } = await seed();
    const uc = new GetLatestUseCase(tracking, locations);
    await expect(uc.execute(OID, "018f4e1a-0999-7c3d-8e4f-5a6b7c8d9e0f", "customer")).rejects.toBeInstanceOf(OrderTrackingNotFoundError);
  });
  it("404s when no projection", async () => {
    const tracking = new FakeOrderTrackingRepo(); const locations = new FakeLocationRepo();
    const uc = new GetLatestUseCase(tracking, locations);
    await expect(uc.execute(OID, CID as unknown as string, "admin")).rejects.toBeInstanceOf(OrderTrackingNotFoundError);
  });
  it("404s when projection exists but no points recorded", async () => {
    const tracking = new FakeOrderTrackingRepo(); const locations = new FakeLocationRepo();
    const t = OrderTracking.fromOrderCreated(OID, CID, NOW); await tracking.save(t);
    const uc = new GetLatestUseCase(tracking, locations);
    await expect(uc.execute(OID, CID as unknown as string, "customer")).rejects.toBeInstanceOf(OrderTrackingNotFoundError);
  });
});

describe("GetRouteUseCase", () => {
  it("returns the breadcrumb page to admin", async () => {
    const { tracking, locations } = await seed();
    const uc = new GetRouteUseCase(tracking, locations);
    const out = await uc.execute(OID, "018f4e1a-0777-7c3d-8e4f-5a6b7c8d9e0f", "admin", 500, null);
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });
});
