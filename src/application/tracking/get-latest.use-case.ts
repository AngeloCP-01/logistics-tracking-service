import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { LocationRepository, LocationPoint } from "../../domain/tracking/location-repository.js";
import type { OrderId } from "../../domain/shared/ids.js";
import { UserId } from "../../domain/shared/ids.js";
import { ForbiddenError, OrderTrackingNotFoundError } from "../../domain/shared/errors.js";

export class GetLatestUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly locations: LocationRepository,
  ) {}

  async execute(orderId: OrderId, userId: string, role: "customer" | "driver" | "admin"): Promise<LocationPoint> {
    const t = await this.tracking.byId(orderId);
    if (!t) throw new OrderTrackingNotFoundError(orderId);
    if (!t.authorize(UserId.of(userId), role)) throw new ForbiddenError();
    const point = await this.locations.latest(orderId);
    if (!point) throw new OrderTrackingNotFoundError(orderId);
    return point;
  }
}
