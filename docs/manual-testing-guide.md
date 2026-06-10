# Tracking Service — Manual Testing Guide

A hands-on walkthrough to exercise `tracking-service` locally end-to-end: the event-sourced authz projection, the WebSocket location stream + lifecycle signals, the Redis fan-out, and the two REST reads. Pair this with [`tracking-service.http`](tracking-service.http) (VS Code REST Client, for the REST reads) and the **driver simulation script** in `logistics-infrastructure`.

> **What makes tracking different from the HTTP services:** the primary ingress is a **WebSocket**, the store is a **Mongo time-series collection** (not Prisma/Postgres), and **there is no HTTP endpoint that starts tracking**. An order becomes trackable when tracking **consumes** `order.created` (→ `customerId`) and `dispatch.driver.assigned` (→ `driverId`) into its `tracking_orders` projection. Authorization (who may watch/emit) is read from that **local projection** — there are **no synchronous service calls** and **no `SERVICE_JWT_SECRET`**. So the flow is: **publish two events → run the driver simulation over WS → watch a customer client + the REST reads.**

---

## 0. Prerequisites

- Docker running.
- Node 20, repo installed (`npm install`) and building (`npm run build`).
- This repo: `/Users/angelito/personal/Logistics-Delivery-Management-System/logistics-tracking-service`.
- The driver simulation lives in the sibling `logistics-infrastructure/scripts/simulate-driver.ts`.

Bring up the dev infra:

```bash
# Mongo (:27018) + Redis (:6380) for tracking (docker-compose.yml)
docker compose up -d

# RabbitMQ: the platform's shared broker `logistics-rabbitmq` (dev/dev creds)
# is probably already running — check `docker ps`. If so, use it and skip this.
# Otherwise start one (a bare image defaults to guest/guest):
#   docker run -d --name logistics-rabbitmq -e RABBITMQ_DEFAULT_USER=dev -e RABBITMQ_DEFAULT_PASS=dev \
#     -p 5672:5672 -p 15672:15672 rabbitmq:3.13-management
```

> **Broker credentials:** the platform's `logistics-rabbitmq` uses **`dev`/`dev`**, so `RABBITMQ_URL=amqp://dev:dev@localhost:5672` (the `.env.example` default). A bare `rabbitmq` image uses `guest`/`guest` — match `RABBITMQ_URL` to whichever broker you point at, or boot fails with `ACCESS_REFUSED`.

> **Ports:** dev Mongo is mapped to **:27018** and dev Redis to **:6380** (to avoid clashing with a platform Mongo 27017 / Redis 6379). `.env.example` already points `TRACKING_MONGO_URL` at `:27018` and `REDIS_URL` at `:6380`.

Create your `.env`:

```bash
cp .env.example .env
export $(grep -v '^#' .env | xargs)
```

`.env` defaults that matter:

| Var | Default | Note |
|---|---|---|
| `PORT` | `3005` | HTTP + WS port |
| `TRACKING_MONGO_URL` | `…:27018/tracking` | dev Mongo (collections + indexes created on boot) |
| `REDIS_URL` | `…:6380` | Socket.IO adapter fan-out |
| `RABBITMQ_URL` | `amqp://dev:dev@localhost:5672` | broker (`logistics-rabbitmq` = dev/dev) |
| `JWT_SECRET` | `change-me-…aaaa` | verifies inbound user JWTs (≥32 chars; see alignment box) |
| `TRACKING_LOCATION_TTL_DAYS` | `30` | location-point retention (TTL on the time-series collection) |

> ### ⚠️ Cross-service alignment
> | If you use… | This must hold | Symptom if wrong |
> |---|---|---|
> | An **auth-service-minted** user token | `JWT_SECRET` **==** auth-service's `AUTH_JWT_SECRET` | WS `connect_error` / REST `401` |
> | The **simulation script** | its `--secret` **==** tracking's `JWT_SECRET` | WS `connect_error` |
>
> There is **no `SERVICE_JWT_SECRET`** — tracking never calls another service. **Restart tracking after any `.env` change** — env is read once at boot.

---

## 1. Boot tracking + verify it's healthy

```bash
npm run dev        # tsx --env-file=.env, listens on :3005 (HTTP + WS)
```

In another terminal:

```bash
curl -s localhost:3005/healthz                 # {"status":"ok"} (liveness)
curl -s -o /dev/null -w "%{http_code}\n" localhost:3005/readyz   # 200 when Mongo + RabbitMQ + Redis are up
```

If `readyz` is `503`: Mongo, RabbitMQ, or Redis isn't reachable — check `docker ps` and the `TRACKING_MONGO_URL` / `REDIS_URL` ports (§0).

On first boot the three collections are created idempotently: `driver_locations` (time-series + 2dsphere + TTL), `tracking_orders` (unique `orderId`), `processed_events` (unique `eventId`).

---

## 2. Mint user JWTs (tracking verifies, never mints)

Tracking verifies with `JWT_SECRET` and needs only `sub` + `role` (HS256). For the simulation, **the driver token's `sub` MUST equal the `driverId`** you assign in §3. For watching/reading, the **customer token's `sub` MUST equal the order's `customerId`** (or use an `admin` token).

```bash
export $(grep -v '^#' .env | xargs)
# CUSTOMER token — sub = the order's customerId (watches + reads):
node -e 'const jwt=require("jsonwebtoken"); console.log(jwt.sign({sub:"47913fd3-7bf9-4182-9d94-6144ddb74cfe", role:"customer"}, process.env.JWT_SECRET, {algorithm:"HS256", expiresIn:"30m"}))'
# ADMIN token (watches/reads any order):
node -e 'const jwt=require("jsonwebtoken"); console.log(jwt.sign({sub:"05950000-0000-7000-8000-00000000adm1", role:"admin"}, process.env.JWT_SECRET, {algorithm:"HS256", expiresIn:"30m"}))'
```

(The simulation script mints its own driver token from `--secret`, so you don't need a driver token by hand.)

Pick the ids you'll use throughout:

| Id | Value (example) |
|---|---|
| `orderId` | `06950000-0000-7000-8000-00000000a001` |
| `customerId` | `47913fd3-7bf9-4182-9d94-6144ddb74cfe` |
| `driverId` | `04950000-0000-7000-8000-000000000d01` |

---

## 3. Make the order trackable (RabbitMQ UI — feed the projection)

Open the RabbitMQ management UI at **http://localhost:15672** (login **dev/dev**) → **Exchanges** → `logistics.events` → **Publish message**. Publish these two (change `eventId` each time). Both must be a **valid envelope** (`eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `producer`, `data`).

**STEP 1 — `order.created`** (sets `customerId` on the projection). Routing key `order.created`:

```json
{
  "eventId": "07950000-0000-7000-8000-aaaaaaaaaaaa",
  "eventType": "order.created",
  "eventVersion": "1.0.0",
  "occurredAt": "2026-06-09T00:00:00Z",
  "correlationId": "smoke-1",
  "producer": "order-service",
  "data": {
    "orderId": "06950000-0000-7000-8000-00000000a001",
    "customerId": "47913fd3-7bf9-4182-9d94-6144ddb74cfe",
    "pickup":  { "label": "Warehouse 3", "street": "12 Dock Rd", "city": "Manila", "country": "PH", "lat": 14.5995, "lng": 120.9842 },
    "dropoff": { "street": "9 Ayala Ave", "city": "Makati", "country": "PH", "lat": 14.6760, "lng": 121.0437 },
    "items": [ { "description": "Sealed parcel", "quantity": 2 } ],
    "scheduledFor": null
  }
}
```

**STEP 2 — `dispatch.driver.assigned`** (sets `driverId` — now the order is fully trackable). Routing key `dispatch.driver.assigned`:

```json
{
  "eventId": "07950000-0000-7000-8000-bbbbbbbbbbbb",
  "eventType": "dispatch.driver.assigned",
  "eventVersion": "1.0.0",
  "occurredAt": "2026-06-09T00:01:00Z",
  "correlationId": "smoke-2",
  "producer": "dispatch-service",
  "data": { "orderId": "06950000-0000-7000-8000-00000000a001", "driverId": "04950000-0000-7000-8000-000000000d01" }
}
```

> Only `data.orderId` / `data.customerId` / `data.driverId` are read for the projection — the rest of `order.created`'s payload is ignored here. The consumer runs at **`prefetch(1)`**, so these two events for the same order can't race on the projection upsert (a real race the integration tests surfaced). The two events may arrive in **either order** — the projection reconciles.

Confirm the projection (optional):

```bash
docker compose exec -T tracking-mongo mongosh tracking --quiet \
  --eval 'db.tracking_orders.find({}, {orderId:1, customerId:1, driverId:1, status:1, _id:0}).toArray()'
# expect: one doc with the orderId, customerId, driverId, status "assigned"
```

---

## 4. Run the driver simulation (the V1 driver client, over WS)

From the **`logistics-infrastructure`** repo, run the simulation. It connects as the assigned driver, joins the room, emits `delivery:pickup`, streams `location:update` along the pickup→dropoff line, then emits `delivery:complete`. Use the SAME `JWT_SECRET` as tracking's:

```bash
cd ../logistics-infrastructure   # the sibling repo where the script lives
npx tsx scripts/simulate-driver.ts \
  --url ws://localhost:3005 \
  --order 06950000-0000-7000-8000-00000000a001 \
  --driver 04950000-0000-7000-8000-000000000d01 \
  --secret "$JWT_SECRET" \
  --from 14.5995,120.9842 --to 14.6760,121.0437
# optional: --steps 20 --interval 3000
```

(`--driver` must match the `driverId` from STEP 2; the script mints a driver JWT with `sub = --driver` signed by `--secret = JWT_SECRET`.)

You should see the simulation log: connect → join → pickup → a sequence of location updates → complete.

---

## 5. Watch a customer client receive the broadcast

While the simulation runs, run a minimal **customer** Socket.IO client to watch the fan-out. Save as `/tmp/watch.mjs` (needs `socket.io-client` — run it from this repo's `node_modules`, or `npm i -g socket.io-client`):

```js
// /tmp/watch.mjs — run: node /tmp/watch.mjs <CUSTOMER_OR_ADMIN_JWT> <orderId>
import { io } from "socket.io-client";
const [token, orderId] = process.argv.slice(2);
const socket = io("ws://localhost:3005", { auth: { token } });
socket.on("connect", () => { console.log("connected"); socket.emit("room:join", { orderId }); });
socket.on("driver:location", (p) => console.log("driver:location", p));
socket.on("delivery:in_transit", (p) => console.log("delivery:in_transit", p));
socket.on("delivery:completed", (p) => console.log("delivery:completed", p));
socket.on("error", (e) => console.log("error", e));
socket.on("connect_error", (e) => console.log("connect_error", e.message));
```

```bash
node /tmp/watch.mjs "<CUSTOMER JWT (sub = the order's customerId)>" 06950000-0000-7000-8000-00000000a001
```

Expect, in order:
- on join: one `driver:location` **snapshot** if a point already exists (else nothing until the first update),
- `delivery:in_transit` (from the simulation's pickup),
- a stream of `driver:location` points,
- `delivery:completed` (from the simulation's complete).

> **Authz:** only the owning **customer** (`sub == customerId`), the assigned **driver** (`sub == driverId`), or an **admin** may join the room. A `room:join` for someone else gets an `error { code: "forbidden" }`. Re-authorization happens on every join, from the local projection.

Behind the scenes: tracking **persists each point to Mongo first**, then broadcasts via the **Redis adapter** — so the customer would still receive points if it were connected to a different instance.

---

## 6. REST reads (after points exist)

Using [`tracking-service.http`](tracking-service.http) (click "Send Request") or curl, with a **customer** (sub = customerId) or **admin** Bearer JWT:

| Action | Expect |
|---|---|
| `GET /tracking/orders/{orderId}/latest` | **200** `{ orderId, lat, lng, ts }` — the last streamed point (404 if none yet) |
| `GET /tracking/orders/{orderId}/route` | **200** `{ orderId, points: [{ lat, lng, ts }, …] }` — the full ordered path |

```bash
TOKEN="<paste CUSTOMER or ADMIN JWT>"
curl -s localhost:3005/tracking/orders/06950000-0000-7000-8000-00000000a001/latest \
  -H "authorization: Bearer $TOKEN"
curl -s localhost:3005/tracking/orders/06950000-0000-7000-8000-00000000a001/route \
  -H "authorization: Bearer $TOKEN"
```

> **No `/v1`** when hitting tracking directly. The gateway adds `/v1` in production (`/v1/tracking/orders/...`).

---

## 7. Negative paths (error shapes)

Run the "Negative-path probes" block in `tracking-service.http`. Expected:

| Probe | Expect |
|---|---|
| REST read, no `Authorization` header | **401** |
| REST read, bogus JWT | **401** |
| REST read of another customer's order (sub != customerId) | **403** |
| REST read of a nonexistent / not-yet-tracked order (admin) | **404** |
| WS `room:join` for an order you don't own (and aren't the driver/admin of) | `error { code: "forbidden" }` |
| WS `location:update` / `delivery:pickup` / `delivery:complete` from a non-assigned driver | `error { code: "forbidden" }`, **state unchanged** |
| WS driver signal for an unknown order | `error { code: "not_found" }` |
| WS driver signal after the delivery is already `completed` | `error { code: "forbidden" }` |

All REST errors are `application/problem+json` (RFC 7807). WS rejections arrive as an `error` event with a `code` + `message` and **never mutate state** (the §8 untrusted-client guards).

A driver **WS drop does not change status** — there is no lost-driver/heartbeat detection in V1; auto-reconnect just resumes streaming.

---

## 8. "Looks good" checklist

- [ ] `healthz` 200, `readyz` 200 (Mongo + RabbitMQ + Redis).
- [ ] STEP 1 + STEP 2 → a `tracking_orders` projection doc with the customerId + driverId (in either publish order).
- [ ] The simulation connects, joins, pickups, streams, completes — no `connect_error`.
- [ ] A customer client receives `delivery:in_transit` → a stream of `driver:location` → `delivery:completed`.
- [ ] `GET /latest` returns the last point; `GET /route` returns the full ordered path.
- [ ] An unauthorized `room:join` / driver signal is rejected with an `error` event and mutates nothing.
- [ ] Every negative probe returns the status / code in the tables.

---

## 9. Teardown

```bash
# Ctrl-C the `npm run dev`, the simulation, and the watch client
docker compose down                 # dev Mongo + Redis
# leave logistics-rabbitmq running (shared); only remove a broker you started yourself
```

---

### Notes / gotchas
- **No `/v1`** when hitting tracking directly (`:3005/tracking/...`). The gateway adds `/v1` in production; the WS endpoint is `wss://api.<domain>/v1/tracking/socket.io/`.
- **Tracking is event-sourced for authz.** No order is trackable until both `order.created` (customerId) and `dispatch.driver.assigned` (driverId) are consumed; there is no HTTP "start tracking".
- **No coordinates drive the lifecycle.** `delivery:pickup` / `delivery:complete` are explicit signals — there is no geofencing.
- **Tracking produces `delivery.in_transit` + `delivery.completed`.** To see them, bind a probe queue to `logistics.events` with those routing keys in the RabbitMQ UI — dispatch/order consume `delivery.completed` to free the driver / close the order.
- The real producers (`order.created` from order-service; `dispatch.driver.assigned` from dispatch-service) replace the RabbitMQ-UI stand-in as those services run alongside; the simulation stands in for the (out-of-scope) real driver client.
