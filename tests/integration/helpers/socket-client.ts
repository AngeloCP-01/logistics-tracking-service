import { io, type Socket } from "socket.io-client";

export interface TestSocket {
  socket: Socket;
  /** Resolves on the next emission of `event`. */
  once: <T = unknown>(event: string) => Promise<T>;
  emit: (event: string, payload: unknown) => void;
  joinRoom: (orderId: string) => Promise<void>;
  close: () => void;
}

export function connectSocket(baseUrl: string, token: string): Promise<TestSocket> {
  const socket = io(baseUrl, { auth: { token }, reconnection: false, transports: ["websocket"], forceNew: true });
  const once = <T = unknown>(event: string): Promise<T> =>
    new Promise<T>((resolve) => socket.once(event, (data: T) => resolve(data)));

  const wrapped: TestSocket = {
    socket,
    once,
    emit: (event, payload) => socket.emit(event, payload),
    joinRoom: (orderId) => {
      socket.emit("room:join", { orderId });
      // a successful join either emits a snapshot or nothing; resolve on the next tick by racing a short timer.
      return new Promise<void>((resolve) => setTimeout(resolve, 150));
    },
    close: () => socket.close(),
  };

  return new Promise<TestSocket>((resolve, reject) => {
    socket.on("connect", () => resolve(wrapped));
    socket.on("connect_error", (err) => reject(err));
  });
}
