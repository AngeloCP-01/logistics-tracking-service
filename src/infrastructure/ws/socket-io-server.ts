import type { Server as HttpServer } from "node:http";
import { Server as IoServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { RedisClient } from "../redis/redis-client.js";

export interface SocketServerHandle {
  io: IoServer;
  close: () => Promise<void>;
}

/**
 * Builds a Socket.IO server attached to the given HTTP server, fanned-out across
 * instances via the Redis adapter (two ioredis clients: a pub + a duplicated sub).
 * CORS is closed by default; the gateway owns the public origin policy.
 */
export function createSocketServer(httpServer: HttpServer, pub: RedisClient, sub: RedisClient): SocketServerHandle {
  const io = new IoServer(httpServer, {
    // Default path "/socket.io/" — the gateway proxies /v1/tracking/socket.io/ to this upstream.
    serveClient: false,
    cors: { origin: false },
  });
  io.adapter(createAdapter(pub, sub));
  return {
    io,
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
