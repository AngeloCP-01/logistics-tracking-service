import type { OrderId, DriverId } from "../shared/ids.js";
import type { Coordinates } from "../shared/coordinates.js";

export interface LocationPoint {
  orderId: OrderId;
  lat: number;
  lng: number;
  ts: Date;
}

export interface RoutePage {
  items: LocationPoint[];
  nextCursor: string | null;
}

export interface LocationRepository {
  /** Persist one accepted location measurement. */
  record(orderId: OrderId, driverId: DriverId, coords: Coordinates, ts: Date): Promise<void>;
  /** Last-known point for an order, or null if none recorded. */
  latest(orderId: OrderId): Promise<LocationPoint | null>;
  /** The breadcrumb, oldest-first, cursor-paginated. cursor is an opaque ISO-ts string. */
  route(orderId: OrderId, limit: number, cursor: string | null): Promise<RoutePage>;
}
