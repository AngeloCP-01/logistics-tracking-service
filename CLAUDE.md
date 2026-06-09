# logistics-tracking-service — Repo Guide

> Real-time driver location ingestion + customer broadcast via WebSocket.

**Phase:** 5 (Tracking Service)
**Status:** ⬜ Not started — scaffold only. Brainstorm a Tracking spec before implementation.

## What this service does

Receives driver location updates over WebSocket, persists them to MongoDB Atlas, broadcasts to subscribed customers via Redis Pub/Sub fan-out. Provisions a room per assigned order. Publishes high-level lifecycle events (`delivery.in_transit`, `delivery.completed`) for the rest of the platform.

## Locked decisions

- **Tech**: Node 20 LTS, TypeScript, Socket.IO, MongoDB Atlas, Redis (Pub/Sub for cross-instance fan-out), Jest.
- **Public endpoint**: `wss://api.<domain>/v1/tracking/socket.io/` (proxied by gateway).
- **Auth**: JWT in WebSocket handshake; server validates, joins room `order:<orderId>` only if user owns the order or is the assigned driver.
- **Events consumed**: `dispatch.driver.assigned` (provision room).
- **Events published**: `delivery.in_transit` (first location update after assignment), `delivery.completed` (driver marks completed or geofence trigger).
- **Persistence**: every location point persisted to MongoDB collection `driver_locations` (driver_id, order_id, lat, lng, accuracy, timestamp). Time-series collection.

## Why MongoDB

- High write volume (one point every few seconds per active driver).
- Flexible schema for future accuracy / heading / speed fields.
- Native time-series collection support.
- Geo queries via 2dsphere index.

## Conventions

- Same as platform: pino, Zod, `/healthz` + `/readyz`, RFC 7807 for HTTP errors.
- Env prefix: `TRACKING_*`.
- WebSocket events: client→server `location:update`, server→client `driver:location`, `delivery:in_transit`, `delivery:completed`.
- Room naming: `order:<orderId>`. Subscriber count tracked in Redis for autoscaling later.

## Open items (decide in the Tracking spec)

- Location update frequency from drivers (every 5s? adaptive based on speed?)
- Sampling for persistence (do we persist every point or downsample?)
- Geofencing (auto-trigger `delivery.in_transit` and `delivery.completed` based on coordinates?)
- Driver simulation algorithm for demos (the script lives in `logistics-infrastructure/scripts/`)
- Disconnect handling (what counts as "lost driver"? reconnection grace period?)
- Time-series retention policy (keep raw points for N days?)

## Don't do

- Don't expose raw driver coordinates to customers who aren't watching their own order. Authorize on every room join.
- Don't write location updates to a relational DB. MongoDB time-series only.
- Don't broadcast from a single Socket.IO instance — always go through Redis Pub/Sub so we can horizontally scale.
- Don't trust the driver's claimed `order_id` in `location:update`. Verify against the assignment from event state.

## Pointers

- Spec: [`../docs/superpowers/specs/2026-05-18-platform-decomposition-design.md`](../docs/superpowers/specs/2026-05-18-platform-decomposition-design.md) §4.4, §4.3
- Plan: TBD (brainstorm + plan in Phase 5)
- Tracker: [`../docs/superpowers/tracker.md`](../docs/superpowers/tracker.md)
