import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { OrderId } from "../../domain/shared/ids.js";
import { UserId } from "../../domain/shared/ids.js";

export class AuthorizeJoinUseCase {
  constructor(private readonly tracking: OrderTrackingRepository) {}

  async execute(orderId: OrderId, userId: string, role: "customer" | "driver" | "admin"): Promise<boolean> {
    const t = await this.tracking.byId(orderId);
    if (!t) return false;                            // unknown order / projection not yet populated → deny (client retries)
    return t.authorize(UserId.of(userId), role);
  }
}
