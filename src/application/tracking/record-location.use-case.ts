import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import type { LocationRepository, LocationPoint } from "../../domain/tracking/location-repository.js";
import type { Clock } from "../ports/clock.js";
import type { OrderId, DriverId } from "../../domain/shared/ids.js";
import type { Coordinates } from "../../domain/shared/coordinates.js";
import { OrderTrackingNotFoundError } from "../../domain/shared/errors.js";

export interface RecordLocationInput {
  orderId: OrderId;
  driverId: DriverId;
  coords: Coordinates;
}

export class RecordLocationUseCase {
  constructor(
    private readonly tracking: OrderTrackingRepository,
    private readonly locations: LocationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: RecordLocationInput, _correlationId: string): Promise<LocationPoint> {
    const t = await this.tracking.byId(input.orderId);
    if (!t) throw new OrderTrackingNotFoundError(input.orderId);
    const ts = this.clock.now();
    await this.locations.record(input.orderId, input.driverId, input.coords, ts);
    return { orderId: input.orderId, lat: input.coords.lat, lng: input.coords.lng, ts };
  }
}
