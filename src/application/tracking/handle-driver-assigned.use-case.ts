import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { ProcessedEventRepository } from "../ports/processed-event-repository.js";
import type { Clock } from "../ports/clock.js";
import { OrderTracking } from "../../domain/tracking/order-tracking.js";
import { OrderId, DriverId } from "../../domain/shared/ids.js";

export interface DriverAssignedInput {
  eventId: string;
  orderId: string;
  driverId: string;
}

export class HandleDriverAssignedUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly processed: ProcessedEventRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: DriverAssignedInput, _correlationId: string): Promise<void> {
    const isNew = await this.processed.recordIfNew(input.eventId, "dispatch.driver.assigned");
    if (!isNew) return;
    const orderId = OrderId.of(input.orderId);
    const driverId = DriverId.of(input.driverId);
    const existing = await this.tracking.byId(orderId);
    if (existing) {
      existing.assignDriver(driverId, this.clock.now());
      await this.tracking.save(existing);
      return;
    }
    await this.tracking.save(OrderTracking.fromDriverAssigned(orderId, driverId, this.clock.now()));
  }
}
