import type { Db, Collection } from "mongodb";
import type { LocationRepository, LocationPoint, RoutePage } from "../../domain/tracking/location-repository.js";
import type { OrderId, DriverId } from "../../domain/shared/ids.js";
import type { Coordinates } from "../../domain/shared/coordinates.js";
import { LOCATIONS } from "./mongo-bootstrap.js";

interface MeasurementDoc {
  ts: Date;
  meta: { orderId: string; driverId: string };
  lat: number;
  lng: number;
  accuracy?: number;
  point: { type: "Point"; coordinates: [number, number] };
}

export function toMeasurement(orderId: OrderId, driverId: DriverId, coords: Coordinates, ts: Date): MeasurementDoc {
  const doc: MeasurementDoc = {
    ts,
    meta: { orderId: orderId as string, driverId: driverId as string },
    lat: coords.lat,
    lng: coords.lng,
    point: coords.toGeoJsonPoint(),
  };
  if (coords.accuracy !== null) doc.accuracy = coords.accuracy;
  return doc;
}

export class MongoLocationRepository implements LocationRepository {
  private readonly coll: Collection<MeasurementDoc>;
  constructor(db: Db) {
    this.coll = db.collection<MeasurementDoc>(LOCATIONS);
  }

  async record(orderId: OrderId, driverId: DriverId, coords: Coordinates, ts: Date): Promise<void> {
    await this.coll.insertOne(toMeasurement(orderId, driverId, coords, ts));
  }

  async latest(orderId: OrderId): Promise<LocationPoint | null> {
    const row = await this.coll.find({ "meta.orderId": orderId as string }).sort({ ts: -1 }).limit(1).next();
    return row ? { orderId, lat: row.lat, lng: row.lng, ts: row.ts } : null;
  }

  async route(orderId: OrderId, limit: number, cursor: string | null): Promise<RoutePage> {
    const filter: Record<string, unknown> = { "meta.orderId": orderId as string };
    if (cursor) filter.ts = { $gt: new Date(cursor) };
    const rows = await this.coll.find(filter).sort({ ts: 1 }).limit(limit + 1).toArray();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items: LocationPoint[] = page.map((r) => ({ orderId, lat: r.lat, lng: r.lng, ts: r.ts }));
    const nextCursor = hasMore ? page[page.length - 1].ts.toISOString() : null;
    return { items, nextCursor };
  }
}
