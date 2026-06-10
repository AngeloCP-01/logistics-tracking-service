import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { LocationRepository, RoutePage } from "../../domain/tracking/location-repository.js";
import type { OrderId } from "../../domain/shared/ids.js";
import { UserId } from "../../domain/shared/ids.js";
import { OrderTrackingNotFoundError } from "../../domain/shared/errors.js";

export class GetRouteUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly locations: LocationRepository,
  ) {}

  async execute(
    orderId: OrderId, userId: string, role: "customer" | "driver" | "admin",
    limit: number, cursor: string | null,
  ): Promise<RoutePage> {
    const t = await this.tracking.byId(orderId);
    // Hide existence from unauthorized callers: absent and present-but-unauthorized
    // both 404 (matches order-service's existence-hiding rule + the WS uniform deny).
    if (!t || !t.authorize(UserId.of(userId), role)) throw new OrderTrackingNotFoundError(orderId);
    return this.locations.route(orderId, limit, cursor);
  }
}
