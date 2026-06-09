import type { Db } from "mongodb";

export const LOCATIONS = "driver_locations";
export const TRACKING_ORDERS = "tracking_orders";
export const PROCESSED_EVENTS = "processed_events";

/**
 * Idempotently ensures the collections + indexes exist:
 *  - driver_locations: time-series (timeField ts, metaField meta) + TTL (expireAfterSeconds) + 2dsphere on `point`.
 *  - tracking_orders: unique orderId.
 *  - processed_events: unique eventId.
 * Safe to call on every boot.
 */
export async function bootstrapMongo(db: Db, locationTtlDays: number): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  if (!existing.has(LOCATIONS)) {
    await db.createCollection(LOCATIONS, {
      timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
      expireAfterSeconds: locationTtlDays * 24 * 60 * 60,
    });
  }
  // 2dsphere on the GeoJSON point stored alongside each measurement. createIndex is idempotent.
  await db.collection(LOCATIONS).createIndex({ point: "2dsphere" });

  if (!existing.has(TRACKING_ORDERS)) await db.createCollection(TRACKING_ORDERS);
  await db.collection(TRACKING_ORDERS).createIndex({ orderId: 1 }, { unique: true });

  if (!existing.has(PROCESSED_EVENTS)) await db.createCollection(PROCESSED_EVENTS);
  await db.collection(PROCESSED_EVENTS).createIndex({ eventId: 1 }, { unique: true });
}
