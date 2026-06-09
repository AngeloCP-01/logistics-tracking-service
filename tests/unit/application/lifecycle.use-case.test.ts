import { StartDeliveryUseCase } from "@/application/tracking/start-delivery.use-case.js";
import { CompleteDeliveryUseCase } from "@/application/tracking/complete-delivery.use-case.js";
import { FakeOrderTrackingRepo, FakePublisher, FixedClock } from "./_fakes.js";
import { OrderTracking } from "@/domain/tracking/order-tracking.js";
import { TrackingStatus } from "@/domain/tracking/tracking-status.js";
import { DeliveryInTransit, DeliveryCompleted } from "@/domain/events/index.js";
import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";

const NOW = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const CID = UserId.of("018f4e1a-0aaa-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

function assigned() {
  const t = OrderTracking.fromOrderCreated(OID, CID, NOW);
  t.assignDriver(D1, NOW);
  return t;
}

describe("StartDeliveryUseCase", () => {
  it("settles in_transit and publishes DeliveryInTransit once", async () => {
    const repo = new FakeOrderTrackingRepo(); await repo.save(assigned());
    const pub = new FakePublisher();
    const uc = new StartDeliveryUseCase(repo, pub, new FixedClock(NOW));
    await uc.execute({ orderId: OID }, "corr");
    expect((await repo.byId(OID))!.status).toBe(TrackingStatus.IN_TRANSIT);
    expect(pub.all()).toHaveLength(1);
    expect(pub.all()[0]).toBeInstanceOf(DeliveryInTransit);
  });

  it("a repeat pickup publishes nothing (idempotent no-op)", async () => {
    const repo = new FakeOrderTrackingRepo(); await repo.save(assigned());
    const pub = new FakePublisher();
    const uc = new StartDeliveryUseCase(repo, pub, new FixedClock(NOW));
    await uc.execute({ orderId: OID }, "corr");
    await uc.execute({ orderId: OID }, "corr");
    expect(pub.all()).toHaveLength(1);                 // not 2
  });
});

describe("CompleteDeliveryUseCase", () => {
  it("settles completed and publishes DeliveryCompleted once", async () => {
    const repo = new FakeOrderTrackingRepo(); const t = assigned(); t.startDelivery(NOW); await repo.save(t);
    const pub = new FakePublisher();
    const uc = new CompleteDeliveryUseCase(repo, pub, new FixedClock(NOW));
    await uc.execute({ orderId: OID }, "corr");
    expect((await repo.byId(OID))!.status).toBe(TrackingStatus.COMPLETED);
    expect(pub.all().filter((e) => e instanceof DeliveryCompleted)).toHaveLength(1);
  });

  it("throws when the order is unknown", async () => {
    const repo = new FakeOrderTrackingRepo();
    const uc = new CompleteDeliveryUseCase(repo, new FakePublisher(), new FixedClock(NOW));
    await expect(uc.execute({ orderId: OID }, "corr")).rejects.toThrow();
  });
});
