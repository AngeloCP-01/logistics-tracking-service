# logistics-tracking-service — Repo Guide

> Real-time delivery tracking: ingests driver location over a WebSocket, persists every point to a Mongo time-series collection, fans it out to the watching customer, and produces the platform's delivery lifecycle events.

**Phase:** 5 (Tracking Service)
**Status:** ✅ v0.1.0 shipped (2026-06-09) — CI green, image `ghcr.io/angelocp-01/tracking-service:latest` + `:<sha>` published.

## What this service does

A real-client-agnostic Socket.IO server. A **driver client** connects with a user JWT, joins its order's room, and streams `location:update` points plus explicit `delivery:pickup` / `delivery:complete` lifecycle signals. The service **persists every point** to a Mongo time-series collection and **broadcasts** `driver:location` to everyone watching that order's room (the **customer**, the **driver**, an **admin**). On pickup it publishes `delivery.in_transit`; on completion `delivery.completed` — tracking is the platform's real producer of these two events, closing the order/dispatch lifecycle loop. Authorization for who may watch/emit comes from a **locally-built event-sourced projection** (`tracking_orders`), so there are **no synchronous service calls**.

In V1 the only driver client is the **simulation script** (`logistics-infrastructure/scripts/simulate-driver.ts`); a real mobile/browser driver app is out of platform scope. The WS server is client-agnostic — the simulation speaks the exact protocol a future real client would.

## Locked decisions (shipped reality — see spec for the 8 decisions + rationale)

1. **Real-client-agnostic WS server.** V1's only driver client is the simulation script (mobile is out of platform scope). The server makes no assumptions about the client.
2. **Explicit lifecycle signals, NO geofencing.** The driver emits `delivery:pickup` / `delivery:complete` directly. Tracking needs **no coordinates** for the lifecycle — there is no geofence trigger, no distance math. Coordinates are for the broadcast + history only.
3. **Persist every point** to a Mongo **time-series** collection (`driver_locations`) with a `2dsphere` index on `point` and a TTL (`TRACKING_LOCATION_TTL_DAYS`, default 30d). **CONFIRMED on mongo 7: a `2dsphere` index on a time-series collection works** — verified in the H2 integration test against the real container. (This was an open question in the old scaffold; it is now settled.)
4. **Event-sourced authz projection — no sync calls.** Consume `order.created` (→ `customerId`) and `dispatch.driver.assigned` (→ `driverId`) into the `tracking_orders` projection; authorize room joins + driver signals from that local state. **NO synchronous service-to-service calls; NO `SERVICE_JWT_SECRET`.**
5. **Socket.IO Redis-adapter fan-out** (persist-then-emit). Two ioredis clients drive the adapter: a pub client + a duplicated sub client. Persist the point first, then broadcast.
6. **On-join snapshot + REST reads.** On `room:join` the last-known point (if any) is emitted to that socket; `GET /tracking/orders/{id}/route` returns the full path, `GET /tracking/orders/{id}/latest` the last point.
7. **Simple disconnect.** A WS drop does **not** change status (auto-reconnect resumes). The §8 guards reject untrusted signals (non-assigned driver / unknown order / already-completed). There is **no lost-driver detection** and no heartbeat in V1.
8. **Native `mongodb` driver, NOT Prisma.** There is no Prisma, no Postgres in this service.

### Events

- **Consumed:** `order.created` (→ `customerId`), `dispatch.driver.assigned` (→ `driverId`). Both feed the `tracking_orders` projection.
- **Produced:** `delivery.in_transit` `{ orderId }` (on pickup), `delivery.completed` `{ orderId }` (on completion). Tracking is the **real producer** of these — dispatch/order consume `delivery.completed` to free the driver / close the order.

### Public surface (via the gateway, which adds the `/v1` prefix)

- **WebSocket:** `wss://api.<domain>/v1/tracking/socket.io/` — Socket.IO v4, handshake JWT in `auth.token`. Protocol is documented in [`../logistics-contracts/docs/tracking-ws.md`](../logistics-contracts/docs/tracking-ws.md) (client→server `room:join` / `location:update` / `delivery:pickup` / `delivery:complete`; server→client `driver:location` / `delivery:in_transit` / `delivery:completed` / `error`).
- **REST:** `GET /tracking/orders/{id}/latest`, `GET /tracking/orders/{id}/route` — owning customer / assigned driver / admin only.
- `GET /healthz` (liveness) + `GET /readyz` (Mongo ping + RabbitMQ channel + Redis ping).

## Architecture

Standard layered Node/TS service (`domain → application → infrastructure → interfaces`, conventions §2.1). Composition root in `src/server.ts` (attributed `BootError`/`bootStep` for Mongo + Redis + RabbitMQ + topology + consumer + HTTP/WS bind; SIGTERM graceful shutdown). `--healthcheck` flag short-circuits before any dependency connection. The high-frequency location stream is over WebSocket; the event consumer carries only the two low-volume projection events.

## Database (MongoDB Atlas, native `mongodb` driver — no Prisma)

Three collections, all bootstrapped idempotently on boot (`src/infrastructure/persistence/mongo-bootstrap.ts`):

| Collection | Shape | Indexes |
|---|---|---|
| `driver_locations` | **time-series** (`timeField: ts`, `metaField: meta`, `granularity: seconds`); each measurement carries a GeoJSON `point` | `2dsphere` on `point`; **TTL** via `expireAfterSeconds` (`TRACKING_LOCATION_TTL_DAYS` × 86400) |
| `tracking_orders` | the authz projection: `{ orderId, customerId?, driverId?, status }` | **unique** `orderId` |
| `processed_events` | consumer idempotency | **unique** `eventId` |

The `OrderTracking` aggregate owns the lifecycle state (assigned → in_transit → completed) and the authz predicates (`canEmitDriverSignal`, room-join authorization). Mappers translate to/from the Mongo documents; they are pure and unit-tested.

## RabbitMQ (the projection consumer)

- Single topic exchange `logistics.events`; durable queue `tracking-service.events` + `tracking-service.events.dlq`; bindings for `order.created` + `dispatch.driver.assigned`; 3-retry-then-DLQ via an `x-attempt` header republish.
- **`prefetch(1)`** on this consumer: the projection upsert is read-then-replace, so two events for the **same order** (`order.created` + `dispatch.driver.assigned`) processed concurrently would race on the `replaceOne` — `driver.assigned` could clobber the real `customerId` placeholder reconciliation. Serializing is cheap (a couple of events per order lifecycle; the high-frequency stream is over WS, not here). **This race was surfaced by the integration tests.**

## Redis (Socket.IO fan-out)

Two ioredis clients (a pub + a `.duplicate()`d sub) back the `@socket.io/redis-adapter`, so a broadcast from any instance reaches sockets connected to any other instance. Persist-then-emit: the point is written to Mongo before the room broadcast.

## Conventions

- Same as platform: pino, Zod (boot-time env), `/healthz` + `/readyz`, RFC 7807 for HTTP errors, Conventional Commits.
- Env prefix `TRACKING_*` (cross-cutting `RABBITMQ_URL` / `REDIS_URL` / `LOG_LEVEL` unprefixed). `JWT_SECRET` verifies inbound user JWTs (= auth's `AUTH_JWT_SECRET`). **No `SERVICE_JWT_SECRET`** — this service makes no sync service calls.
- Local dev ports: HTTP **3005**, dev Mongo **27018**, dev Redis **6380** (avoid clashing with the platform 27017 / 6379).
- Shared TS/ESLint/Prettier configs are **vendored** (conventions §22), not imported.

### Repo deviation from the typical platform service

This service uses the **native `mongodb` driver** (time-series collection, not Prisma/Postgres) and a **Socket.IO WebSocket layer** (not just HTTP). It is the only V1 service whose primary ingress is a WebSocket and whose store is Mongo. The layered architecture, port/adapter discipline, and event-envelope rules are unchanged.

## Testing

- **Unit tests** — strict TDD on `domain/` + `application/`; in-memory fakes for the ports (location repo, tracking repo, event publisher, processed-events, clock).
- **Integration tests** (testcontainers: real Mongo + Redis + RabbitMQ): the Mongo time-series write + TTL + **2dsphere-on-time-series** + latest/route; the full WS happy path (project → broadcast → lifecycle → snapshot); the WS authz matrix + untrusted-signal guards; consumer idempotency + out-of-order projection; HTTP read authz + readyz dependency-down probes.
- `npm test` (unit), `npm run test:int` (needs Docker), `npm run typecheck`, `npm run lint`.

## Don't do

- Don't add geofencing or coordinate-based lifecycle triggers — the lifecycle is **explicit** signals (`delivery:pickup` / `delivery:complete`); tracking needs no coordinates for it.
- Don't add a synchronous service call or a `SERVICE_JWT_SECRET` — authz comes from the local `tracking_orders` projection, fed by events.
- Don't trust the client's claimed `orderId`/`driverId` on a driver signal — the §8 guard checks the projection (assigned driver, known order, not already completed).
- Don't broadcast from a single Socket.IO instance — always go through the Redis adapter so we can scale horizontally.
- Don't reach for Prisma/Postgres — this service is the native-`mongodb` time-series exception.
- Don't expose a point to a customer who isn't the order's owner — authorize on every room join and every REST read.
- Don't add lost-driver / heartbeat detection in V1 — a WS drop is a no-op (auto-reconnect resumes).

## Pointers

- Spec: [`../docs/superpowers/specs/2026-06-09-tracking-service-design.md`](../docs/superpowers/specs/2026-06-09-tracking-service-design.md)
- Plan: [`../docs/superpowers/plans/2026-06-09-phase-5-tracking-service.md`](../docs/superpowers/plans/2026-06-09-phase-5-tracking-service.md)
- OpenAPI (REST reads): [`../logistics-contracts/openapi/tracking-service.yaml`](../logistics-contracts/openapi/tracking-service.yaml)
- WebSocket protocol: [`../logistics-contracts/docs/tracking-ws.md`](../logistics-contracts/docs/tracking-ws.md)
- Local exercise file (REST Client): [`docs/tracking-service.http`](docs/tracking-service.http)
- Manual testing guide: [`docs/manual-testing-guide.md`](docs/manual-testing-guide.md)
- Tracker: [`../docs/superpowers/tracker.md`](../docs/superpowers/tracker.md)
