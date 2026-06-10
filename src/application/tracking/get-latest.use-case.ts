import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { LocationRepository, LocationPoint } from "../../domain/tracking/location-repository.js";
import type { OrderId } from "../../domain/shared/ids.js";
import { UserId } from "../../domain/shared/ids.js";
import { OrderTrackingNotFoundError } from "../../domain/shared/errors.js";

export class GetLatestUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly locations: LocationRepository,
  ) {}

  async execute(orderId: OrderId, userId: string, role: "customer" | "driver" | "admin"): Promise<LocationPoint> {
    const t = await this.tracking.byId(orderId);
    // Hide existence from unauthorized callers: an absent order and a present-but-
    // unauthorized order both 404, so a stranger can't probe which orders exist
    // (matches order-service's existence-hiding rule + the WS join path's uniform deny).
    if (!t || !t.authorize(UserId.of(userId), role)) throw new OrderTrackingNotFoundError(orderId);
    const point = await this.locations.latest(orderId);
    if (!point) throw new OrderTrackingNotFoundError(orderId);
    return point;
  }
}
