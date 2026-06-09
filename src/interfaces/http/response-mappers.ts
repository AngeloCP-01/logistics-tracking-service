import type { LocationPoint, RoutePage } from "../../domain/tracking/location-repository.js";

export function toPointResponse(p: LocationPoint): { orderId: string; lat: number; lng: number; ts: string } {
  return { orderId: p.orderId as string, lat: p.lat, lng: p.lng, ts: p.ts.toISOString() };
}

export function toRouteResponse(page: RoutePage): {
  items: ReturnType<typeof toPointResponse>[];
  nextCursor: string | null;
} {
  return { items: page.items.map(toPointResponse), nextCursor: page.nextCursor };
}
