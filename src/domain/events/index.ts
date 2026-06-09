export { DeliveryInTransit } from "./delivery-in-transit.js";
export { DeliveryCompleted } from "./delivery-completed.js";
import type { DeliveryInTransit } from "./delivery-in-transit.js";
import type { DeliveryCompleted } from "./delivery-completed.js";
export type DomainEvent = DeliveryInTransit | DeliveryCompleted;
