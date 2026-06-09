import type { Db, Collection } from "mongodb";
import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import { OrderTracking, type OrderTrackingProps } from "../../domain/tracking/order-tracking.js";
import { OrderId, DriverId, UserId } from "../../domain/shared/ids.js";
import type { TrackingStatus } from "../../domain/tracking/tracking-status.js";
import { TRACKING_ORDERS } from "./mongo-bootstrap.js";

export interface OrderTrackingDoc {
  orderId: string;
  customerId: string;
  driverId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toDoc(t: OrderTracking): OrderTrackingDoc {
  const p = t.toProps();
  return {
    orderId: p.orderId as string,
    customerId: p.customerId as string,
    driverId: p.driverId === null ? null : (p.driverId as string),
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function fromDoc(doc: OrderTrackingDoc): OrderTracking {
  const props: OrderTrackingProps = {
    orderId: OrderId.of(doc.orderId),
    customerId: UserId.of(doc.customerId),
    driverId: doc.driverId === null ? null : DriverId.of(doc.driverId),
    status: doc.status as TrackingStatus,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  return OrderTracking.fromPersistence(props);
}

export class MongoOrderTrackingRepository implements OrderTrackingRepository {
  private readonly coll: Collection<OrderTrackingDoc>;
  constructor(db: Db) {
    this.coll = db.collection<OrderTrackingDoc>(TRACKING_ORDERS);
  }

  async byId(orderId: OrderId): Promise<OrderTracking | null> {
    const doc = await this.coll.findOne({ orderId: orderId as string });
    return doc ? fromDoc(doc) : null;
  }

  async save(tracking: OrderTracking): Promise<void> {
    const doc = toDoc(tracking);
    await this.coll.replaceOne({ orderId: doc.orderId }, doc, { upsert: true });
  }
}
