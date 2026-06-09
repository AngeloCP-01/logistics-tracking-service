import { HandleDriverAssignedUseCase } from "@/application/tracking/handle-driver-assigned.use-case.js";
import { FakeOrderTrackingRepo, FakeProcessedEvents, FixedClock } from "./_fakes.js";
import { OrderId } from "@/domain/shared/ids.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
const DID = "018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f";
const CID = "018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f";

function build() {
  const repo = new FakeOrderTrackingRepo();
  const processed = new FakeProcessedEvents();
  const uc = new HandleDriverAssignedUseCase(repo, processed, new FixedClock(NOW));
  return { repo, processed, uc };
}

describe("HandleDriverAssignedUseCase", () => {
  it("sets the driverId on an existing created projection", async () => {
    const { repo, uc } = build();
    const { OrderTracking } = await import("@/domain/tracking/order-tracking.js");
    const { UserId } = await import("@/domain/shared/ids.js");
    await repo.save(OrderTracking.fromOrderCreated(OrderId.of(OID), UserId.of(CID), NOW));
    await uc.execute({ eventId: "e1", orderId: OID, driverId: DID }, "corr");
    expect((await repo.byId(OrderId.of(OID)))!.driverId).toBe(DID);
  });

  it("creates a placeholder-customer projection when assigned arrives first (out-of-order)", async () => {
    const { repo, uc } = build();
    await uc.execute({ eventId: "e1", orderId: OID, driverId: DID }, "corr");
    const t = (await repo.byId(OrderId.of(OID)))!;
    expect(t.driverId).toBe(DID);
    expect(t.hasPlaceholderCustomer()).toBe(true);
  });

  it("is idempotent on a duplicate eventId", async () => {
    const { repo, uc } = build();
    await uc.execute({ eventId: "e1", orderId: OID, driverId: DID }, "corr");
    const first = await repo.byId(OrderId.of(OID));
    await uc.execute({ eventId: "e1", orderId: OID, driverId: DID }, "corr");
    expect(await repo.byId(OrderId.of(OID))).toBe(first);
  });
});
