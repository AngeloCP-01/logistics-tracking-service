import { HandleOrderCreatedUseCase } from "@/application/tracking/handle-order-created.use-case.js";
import { FakeOrderTrackingRepo, FakeProcessedEvents, FixedClock } from "./_fakes.js";
import { OrderId } from "@/domain/shared/ids.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
const CID = "018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f";

function build() {
  const repo = new FakeOrderTrackingRepo();
  const processed = new FakeProcessedEvents();
  const uc = new HandleOrderCreatedUseCase(repo, processed, new FixedClock(NOW));
  return { repo, processed, uc };
}

describe("HandleOrderCreatedUseCase", () => {
  it("upserts a created projection with the customerId", async () => {
    const { repo, uc } = build();
    await uc.execute({ eventId: "e1", orderId: OID, customerId: CID }, "corr");
    const t = await repo.byId(OrderId.of(OID));
    expect(t).not.toBeNull();
    expect(t!.customerId).toBe(CID);
    expect(t!.status).toBe(TrackingStatus.CREATED);
  });

  it("is idempotent on a duplicate eventId (no second write)", async () => {
    const { repo, uc } = build();
    await uc.execute({ eventId: "e1", orderId: OID, customerId: CID }, "corr");
    const first = await repo.byId(OrderId.of(OID));
    await uc.execute({ eventId: "e1", orderId: OID, customerId: CID }, "corr");
    expect(await repo.byId(OrderId.of(OID))).toBe(first);   // same instance, not overwritten
  });

  it("reconciles the real customerId onto a placeholder when order.created arrives after driver.assigned (out-of-order)", async () => {
    const { repo, uc } = build();
    // Simulate an assigned-before-created placeholder projection already present:
    const { OrderTracking } = await import("@/domain/tracking/order-tracking.js");
    const { DriverId } = await import("@/domain/shared/ids.js");
    const existing = OrderTracking.fromDriverAssigned(
      OrderId.of(OID),
      DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f"),
      NOW,
    );
    await repo.save(existing);
    await uc.execute({ eventId: "e1", orderId: OID, customerId: CID }, "corr");
    const t = await repo.byId(OrderId.of(OID));
    expect(t!.driverId).not.toBeNull();                    // driverId preserved
    expect(t!.customerId).toBe(CID);                       // placeholder reconciled to the real customerId
  });
});
