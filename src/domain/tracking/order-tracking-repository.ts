import type { OrderTracking } from "./order-tracking.js";
import type { OrderId } from "../shared/ids.js";

export interface OrderTrackingRepository {
  byId(orderId: OrderId): Promise<OrderTracking | null>;
  save(tracking: OrderTracking): Promise<void>;
}
