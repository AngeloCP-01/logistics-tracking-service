import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { ProcessedEventRepository } from "../ports/processed-event-repository.js";
import type { Clock } from "../ports/clock.js";
import { OrderTracking } from "../../domain/tracking/order-tracking.js";
import { OrderId, UserId } from "../../domain/shared/ids.js";

export interface OrderCreatedInput {
  eventId: string;
  orderId: string;
  customerId: string;
}

export class HandleOrderCreatedUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly processed: ProcessedEventRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: OrderCreatedInput, _correlationId: string): Promise<void> {
    const isNew = await this.processed.recordIfNew(input.eventId, "order.created");
    if (!isNew) return;
    const orderId = OrderId.of(input.orderId);
    const customerId = UserId.of(input.customerId);
    const existing = await this.tracking.byId(orderId);
    if (existing) return;   // already projected (e.g. assigned arrived first); customerId is set at creation-time, preserve driverId
    await this.tracking.save(OrderTracking.fromOrderCreated(orderId, customerId, this.clock.now()));
  }
}
