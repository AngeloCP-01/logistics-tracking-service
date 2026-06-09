import { AuthorizeJoinUseCase } from "@/application/tracking/authorize-join.use-case.js";
import { FakeOrderTrackingRepo } from "./_fakes.js";
import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { OrderId, UserId } from "@/domain/shared/ids.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");

describe("AuthorizeJoinUseCase", () => {
  it("allows the owning customer", async () => {
    const repo = new FakeOrderTrackingRepo(); await repo.save(OrderTracking.fromOrderCreated(OID, CID, NOW));
    const uc = new AuthorizeJoinUseCase(repo);
    expect(await uc.execute(OID, CID as unknown as string, "customer")).toBe(true);
  });
  it("denies a stranger customer", async () => {
    const repo = new FakeOrderTrackingRepo(); await repo.save(OrderTracking.fromOrderCreated(OID, CID, NOW));
    const uc = new AuthorizeJoinUseCase(repo);
    expect(await uc.execute(OID, "018f4e1a-0999-7c3d-8e4f-5a6b7c8d9e0f", "customer")).toBe(false);
  });
  it("denies when the projection is absent (unknown order / race)", async () => {
    const repo = new FakeOrderTrackingRepo();
    const uc = new AuthorizeJoinUseCase(repo);
    expect(await uc.execute(OID, CID as unknown as string, "admin")).toBe(false);
  });
});
