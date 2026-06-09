import type { Clock } from "@/application/ports/clock.js";
import type { EventPublisher } from "@/application/ports/event-publisher.js";
import type { ProcessedEventRepository } from "@/application/ports/processed-event-repository.js";
import type { OrderTrackingRepository } from "@/domain/tracking/order-tracking-repository.js";
import type { LocationRepository, LocationPoint, RoutePage } from "@/domain/tracking/location-repository.js";
import type { OrderTracking } from "@/domain/tracking/order-tracking.js";
import type { DomainEvent } from "@/domain/events/index.js";
import type { OrderId, DriverId } from "@/domain/shared/ids.js";
import type { Coordinates } from "@/domain/shared/coordinates.js";

export class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date { return this.fixed; }
}

export class FakePublisher implements EventPublisher {
  published: { events: DomainEvent[]; correlationId: string }[] = [];
  async publishAll(events: DomainEvent[], correlationId: string): Promise<void> {
    if (events.length) this.published.push({ events, correlationId });
  }
  all(): DomainEvent[] { return this.published.flatMap((p) => p.events); }
}

export class FakeProcessedEvents implements ProcessedEventRepository {
  private seen = new Set<string>();
  async recordIfNew(eventId: string, _eventType: string): Promise<boolean> {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }
}

export class FakeOrderTrackingRepo implements OrderTrackingRepository {
  store = new Map<string, OrderTracking>();
  async byId(orderId: OrderId): Promise<OrderTracking | null> {
    return this.store.get(orderId as string) ?? null;
  }
  async save(tracking: OrderTracking): Promise<void> {
    this.store.set(tracking.orderId as string, tracking);
  }
}

export class FakeLocationRepo implements LocationRepository {
  points: LocationPoint[] = [];
  async record(orderId: OrderId, _driverId: DriverId, coords: Coordinates, ts: Date): Promise<void> {
    this.points.push({ orderId, lat: coords.lat, lng: coords.lng, ts });
  }
  async latest(orderId: OrderId): Promise<LocationPoint | null> {
    const forOrder = this.points.filter((p) => (p.orderId as string) === (orderId as string));
    return forOrder.length ? forOrder[forOrder.length - 1] : null;
  }
  async route(orderId: OrderId, limit: number, cursor: string | null): Promise<RoutePage> {
    let forOrder = this.points
      .filter((p) => (p.orderId as string) === (orderId as string))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    if (cursor) forOrder = forOrder.filter((p) => p.ts.toISOString() > cursor);
    const page = forOrder.slice(0, limit);
    const nextCursor = forOrder.length > limit ? page[page.length - 1].ts.toISOString() : null;
    return { items: page, nextCursor };
  }
}
