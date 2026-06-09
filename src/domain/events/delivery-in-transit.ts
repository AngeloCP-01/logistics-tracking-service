import type { OrderId } from "../shared/ids.js";

export class DeliveryInTransit {
  readonly eventType = "delivery.in_transit" as const;
  constructor(
    readonly orderId: OrderId,
    readonly occurredAt: Date,
  ) {}
}
