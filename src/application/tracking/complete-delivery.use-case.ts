import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { EventPublisher } from "../ports/event-publisher.js";
import type { Clock } from "../ports/clock.js";
import type { OrderId } from "../../domain/shared/ids.js";
import { OrderTrackingNotFoundError } from "../../domain/shared/errors.js";

export interface CompleteDeliveryInput {
  orderId: OrderId;
}

export class CompleteDeliveryUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(input: CompleteDeliveryInput, correlationId: string): Promise<void> {
    const t = await this.tracking.byId(input.orderId);
    if (!t) throw new OrderTrackingNotFoundError(input.orderId);
    const changed = t.completeDelivery(this.clock.now());
    if (!changed) return;
    await this.tracking.save(t);
    await this.publisher.publishAll(t.pullEvents(), correlationId);
  }
}
