# logistics-tracking-service

Real-time delivery tracking for the AI Logistics & Delivery Management Platform. A **Socket.IO** server ingests a driver's `location:update` stream + explicit `delivery:pickup` / `delivery:complete` signals, **persists every point** to a MongoDB **time-series** collection (2dsphere + TTL), **fans out** `driver:location` to the watching customer via the Redis adapter, and **produces** the platform's delivery lifecycle events `delivery.in_transit` + `delivery.completed`. Authorization comes from a **local event-sourced projection** (built from `order.created` + `dispatch.driver.assigned`) — there are **no synchronous service calls**.

**Phase:** 5 · **Status:** v0.1.0 · Node 20 / TypeScript (ESM) / Express + Socket.IO / native `mongodb` driver + Mongo time-series / Redis (Socket.IO adapter) / RabbitMQ.

See the design spec: [`../docs/superpowers/specs/2026-06-09-tracking-service-design.md`](../docs/superpowers/specs/2026-06-09-tracking-service-design.md), the plan: [`../docs/superpowers/plans/2026-06-09-phase-5-tracking-service.md`](../docs/superpowers/plans/2026-06-09-phase-5-tracking-service.md), and the WebSocket protocol: [`../logistics-contracts/docs/tracking-ws.md`](../logistics-contracts/docs/tracking-ws.md).

## Public surface

- **WebSocket** (gateway-proxied): `wss://api.<domain>/v1/tracking/socket.io/` — Socket.IO v4, handshake JWT in `auth.token`. Client→server: `room:join`, `location:update`, `delivery:pickup`, `delivery:complete`. Server→client: `driver:location`, `delivery:in_transit`, `delivery:completed`, `error`. Full protocol in the WS doc above.
- **REST reads** (owning customer / assigned driver / admin only):
  - `GET /tracking/orders/{id}/latest` — the last-known point.
  - `GET /tracking/orders/{id}/route` — the full ordered path.
- `GET /healthz` · `GET /readyz` (Mongo + RabbitMQ + Redis).

Errors are RFC 7807 Problem Details. There is **no HTTP endpoint to start tracking** — an order becomes trackable when the service consumes `order.created` + `dispatch.driver.assigned`.

## Events

- **Produces:** `delivery.in_transit` `{ orderId }` (on `delivery:pickup`), `delivery.completed` `{ orderId }` (on `delivery:complete`). Tracking is the platform's **real producer** of these.
- **Consumes:** `order.created` (→ `customerId`) + `dispatch.driver.assigned` (→ `driverId`), both into the `tracking_orders` authz projection.

All events use the shared envelope from `@angelocp-01/logistics-contracts`. The consumer is idempotent (`processed_events` dedup), runs at `prefetch(1)` (serializes the read-then-write projection upsert), and tolerates out-of-order delivery.

## Storage (MongoDB, native driver — no Prisma)

| Collection | Shape | Indexes |
|---|---|---|
| `driver_locations` | **time-series** (`ts` timeField, `meta` metaField), each point with a GeoJSON `point` | `2dsphere` on `point` + **TTL** (`TRACKING_LOCATION_TTL_DAYS` days) |
| `tracking_orders` | authz projection `{ orderId, customerId?, driverId?, status }` | unique `orderId` |
| `processed_events` | consumer idempotency | unique `eventId` |

A `2dsphere` index on a time-series collection works on Mongo 7 (verified in the integration suite).

## Local development

```bash
docker compose up -d            # dev Mongo on :27018 + Redis on :6380
cp .env.example .env            # then fill in secrets
npm install
npm run dev                     # tsx --env-file=.env, listens on PORT (default 3005)
```

Point `RABBITMQ_URL` at the platform broker (`logistics-rabbitmq`, dev/dev creds — `amqp://dev:dev@localhost:5672`). The Mongo collections + indexes are created idempotently on boot.

## Configuration

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` / `test` / `production` |
| `PORT` | HTTP + WS port (default `3005`) |
| `LOG_LEVEL` | pino level (`debug` / `info` / `warn` / `error`) |
| `LOG_SERVICE_NAME` | service name stamped on every log line |
| `TRACKING_MONGO_URL` | MongoDB connection string (`mongodb://…` / `mongodb+srv://…`) |
| `REDIS_URL` | Redis — the Socket.IO adapter pub/sub fan-out |
| `RABBITMQ_URL` | broker (the projection consumer) |
| `JWT_SECRET` | verify inbound user JWTs (HS256; = auth's `AUTH_JWT_SECRET`) — min 32 chars |
| `TRACKING_LOCATION_TTL_DAYS` | location-point retention, TTL on the time-series collection (default `30`) |

There is **no `SERVICE_JWT_SECRET`** — tracking makes no synchronous service-to-service calls.

## Testing

```bash
npm test          # unit (domain + application), fast, in-memory fakes
npm run test:int  # integration via testcontainers (real Mongo + Redis + RabbitMQ) — needs Docker
npm run typecheck && npm run lint
```

Unit tests use in-memory fakes; integration tests exercise the real wired app, WS layer, and event consumer against real containers — the Mongo **time-series + 2dsphere + TTL** write/read, the full WS happy path (project → broadcast → lifecycle → snapshot), the WS authz matrix + untrusted-signal guards, consumer idempotency + out-of-order projection, and HTTP read authz + readyz dependency-down probes.

**Manual / exploratory testing:** [`docs/manual-testing-guide.md`](docs/manual-testing-guide.md) is a step-by-step end-to-end walkthrough (publish the two projection events → run the driver simulation → watch a customer client receive the broadcast + lifecycle), and [`docs/tracking-service.http`](docs/tracking-service.http) is a VS Code REST Client file for the two REST reads.

## Architecture

Clean Architecture: `src/{domain,application,infrastructure,interfaces,config}` + `server.ts` (composition root, attributed boot errors, SIGTERM graceful shutdown). Dependencies point inward; `infrastructure` implements the ports declared in `domain`/`application`. The `OrderTracking` aggregate owns the lifecycle state + authz predicates; Mongo / Redis / RabbitMQ / Socket.IO / HTTP are adapters behind ports. This is the platform's native-`mongodb` + WebSocket exception (every other V1 backend service is Prisma/Postgres HTTP).
