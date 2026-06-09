import type { Server as IoServer, Socket } from "socket.io";
import type { Logger } from "pino";
import type { UserJwtVerifier } from "../../infrastructure/auth/user-jwt-verifier.js";
import type { AuthorizeJoinUseCase } from "../../application/tracking/authorize-join.use-case.js";
import type { RecordLocationUseCase } from "../../application/tracking/record-location.use-case.js";
import type { StartDeliveryUseCase } from "../../application/tracking/start-delivery.use-case.js";
import type { CompleteDeliveryUseCase } from "../../application/tracking/complete-delivery.use-case.js";
import type { GetLatestUseCase } from "../../application/tracking/get-latest.use-case.js";
import type { OrderTrackingRepository } from "../../domain/tracking/order-tracking-repository.js";
import { OrderId, DriverId, UserId } from "../../domain/shared/ids.js";
import { Coordinates } from "../../domain/shared/coordinates.js";

export interface WsDeps {
  io: IoServer;
  logger: Logger;
  userJwt: UserJwtVerifier;
  authorizeJoin: AuthorizeJoinUseCase;
  recordLocation: RecordLocationUseCase;
  startDelivery: StartDeliveryUseCase;
  completeDelivery: CompleteDeliveryUseCase;
  getLatest: GetLatestUseCase;
  tracking: OrderTrackingRepository;
}

interface SocketUser {
  userId: string;
  role: "customer" | "driver" | "admin";
}

function roomOf(orderId: string): string {
  return `order:${orderId}`;
}

function fail(socket: Socket, code: string, message: string): void {
  socket.emit("error", { code, message });
}

export function registerWsHandlers(deps: WsDeps): void {
  const { io, logger } = deps;

  // --- Handshake auth (every connection) ---
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== "string" || token.length === 0) {
      next(new Error("unauthorized: missing token"));
      return;
    }
    try {
      const claims = deps.userJwt.verify(token);
      (socket.data as { user?: SocketUser }).user = { userId: claims.userId, role: claims.role };
      next();
    } catch {
      next(new Error("unauthorized: invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket.data as { user: SocketUser }).user;
    logger.info({ event: "ws_connected", userId: user.userId, role: user.role });

    // --- Room join (re-authorize on every join) ---
    socket.on("room:join", async (payload: { orderId?: unknown }) => {
      const orderIdRaw = payload?.orderId;
      if (typeof orderIdRaw !== "string") return fail(socket, "validation_failed", "orderId required");
      let orderId: OrderId;
      try {
        orderId = OrderId.of(orderIdRaw);
      } catch {
        return fail(socket, "validation_failed", "invalid orderId");
      }

      const allowed = await deps.authorizeJoin.execute(orderId, user.userId, user.role);
      if (!allowed) return fail(socket, "forbidden", "not authorized to join this order's room");

      await socket.join(roomOf(orderIdRaw));

      // On-join snapshot: emit the last-known point to THIS socket if one exists.
      try {
        const latest = await deps.getLatest.execute(orderId, user.userId, user.role);
        socket.emit("driver:location", {
          orderId: orderIdRaw,
          lat: latest.lat,
          lng: latest.lng,
          ts: latest.ts.toISOString(),
        });
      } catch {
        /* no snapshot if no point recorded yet — not an error */
      }
    });

    // --- location:update (assigned-driver guard) ---
    socket.on(
      "location:update",
      async (payload: { orderId?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown }) => {
        const guard = await checkDriverSignal(deps, socket, user, payload?.orderId);
        if (!guard) return;
        let coords: Coordinates;
        try {
          coords = Coordinates.of(
            Number(payload.lat),
            Number(payload.lng),
            payload.accuracy === undefined ? undefined : Number(payload.accuracy),
          );
        } catch {
          return fail(socket, "validation_failed", "invalid coordinates");
        }
        const out = await deps.recordLocation.execute(
          { orderId: guard.orderId, driverId: DriverId.of(user.userId), coords },
          socket.id,
        );
        io.to(roomOf(guard.orderId as string)).emit("driver:location", {
          orderId: guard.orderId as string,
          lat: out.lat,
          lng: out.lng,
          ts: out.ts.toISOString(),
        });
      },
    );

    // --- delivery:pickup ---
    socket.on("delivery:pickup", async (payload: { orderId?: unknown }) => {
      const guard = await checkDriverSignal(deps, socket, user, payload?.orderId);
      if (!guard) return;
      await deps.startDelivery.execute({ orderId: guard.orderId }, socket.id);
      io.to(roomOf(guard.orderId as string)).emit("delivery:in_transit", { orderId: guard.orderId as string });
    });

    // --- delivery:complete ---
    socket.on("delivery:complete", async (payload: { orderId?: unknown }) => {
      const guard = await checkDriverSignal(deps, socket, user, payload?.orderId);
      if (!guard) return;
      await deps.completeDelivery.execute({ orderId: guard.orderId }, socket.id);
      io.to(roomOf(guard.orderId as string)).emit("delivery:completed", { orderId: guard.orderId as string });
    });
  });
}

/**
 * §8 guard for driver signals: validates orderId, loads the projection, and rejects
 * (emitting `error`, mutating nothing) when the socket is not the assigned driver,
 * the order is unknown, or it is already completed. Returns the OrderId on success.
 */
async function checkDriverSignal(
  deps: WsDeps,
  socket: Socket,
  user: SocketUser,
  orderIdRaw: unknown,
): Promise<{ orderId: OrderId } | null> {
  if (typeof orderIdRaw !== "string") {
    fail(socket, "validation_failed", "orderId required");
    return null;
  }
  let orderId: OrderId;
  try {
    orderId = OrderId.of(orderIdRaw);
  } catch {
    fail(socket, "validation_failed", "invalid orderId");
    return null;
  }
  const t = await deps.tracking.byId(orderId);
  if (!t) {
    fail(socket, "not_found", "unknown order");
    return null;
  }
  if (!t.canEmitDriverSignal(UserId.of(user.userId))) {
    fail(socket, "forbidden", "not the assigned driver, or the delivery is completed");
    return null;
  }
  return { orderId };
}
