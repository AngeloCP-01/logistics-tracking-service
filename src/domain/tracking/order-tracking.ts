import type { OrderId, DriverId, UserId } from "../shared/ids.js";
import { TrackingStatus, isAtOrAfter } from "./tracking-status.js";
import { DeliveryInTransit, DeliveryCompleted } from "../events/index.js";
import type { DomainEvent } from "../events/index.js";

export interface OrderTrackingProps {
  orderId: OrderId;
  customerId: UserId;
  driverId: DriverId | null;
  status: TrackingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class OrderTracking {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: OrderTrackingProps) {}

  static fromOrderCreated(orderId: OrderId, customerId: UserId, now: Date): OrderTracking {
    return new OrderTracking({
      orderId, customerId, driverId: null,
      status: TrackingStatus.CREATED, createdAt: now, updatedAt: now,
    });
  }

  static fromPersistence(props: OrderTrackingProps): OrderTracking {
    return new OrderTracking({ ...props });
  }

  get orderId(): OrderId { return this.props.orderId; }
  get customerId(): UserId { return this.props.customerId; }
  get driverId(): DriverId | null { return this.props.driverId; }
  get status(): TrackingStatus { return this.props.status; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  assignDriver(driverId: DriverId, now: Date): void {
    this.props.driverId = driverId;
    this.props.updatedAt = now;
  }

  /** Idempotent: returns true and records DeliveryInTransit only when this advances to in_transit. */
  startDelivery(now: Date): boolean {
    if (isAtOrAfter(this.props.status, TrackingStatus.IN_TRANSIT)) return false;
    this.props.status = TrackingStatus.IN_TRANSIT;
    this.props.updatedAt = now;
    this.events.push(new DeliveryInTransit(this.props.orderId, now));
    return true;
  }

  /** Idempotent: returns true and records DeliveryCompleted only when this advances to completed. */
  completeDelivery(now: Date): boolean {
    if (isAtOrAfter(this.props.status, TrackingStatus.COMPLETED)) return false;
    this.props.status = TrackingStatus.COMPLETED;
    this.props.updatedAt = now;
    this.events.push(new DeliveryCompleted(this.props.orderId, now));
    return true;
  }

  authorize(userId: UserId, role: "customer" | "driver" | "admin"): boolean {
    if (role === "admin") return true;
    if (role === "customer") return (this.props.customerId as string) === (userId as string);
    // role === "driver"
    return this.props.driverId !== null && (this.props.driverId as string) === (userId as string);
  }

  /** §8 guard: only the assigned driver, only before completion, may emit location/pickup/complete. */
  canEmitDriverSignal(userId: UserId): boolean {
    if (this.props.driverId === null) return false;
    if ((this.props.driverId as string) !== (userId as string)) return false;
    return !isAtOrAfter(this.props.status, TrackingStatus.COMPLETED);
  }

  toProps(): OrderTrackingProps { return { ...this.props }; }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0);
  }
}
