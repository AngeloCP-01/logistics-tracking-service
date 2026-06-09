import type { OrderId } from "../shared/ids.js";

export class DeliveryCompleted {
  readonly eventType = "delivery.completed" as const;
  constructor(
    readonly orderId: OrderId,
    readonly occurredAt: Date,
  ) {}
}
