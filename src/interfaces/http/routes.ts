import { Router } from "express";
import type { TrackingReadController } from "./controllers/tracking-read-controller.js";

export function trackingRoutes(c: TrackingReadController): Router {
  const r = Router();
  r.get("/tracking/orders/:orderId/latest", c.latestHandler);
  r.get("/tracking/orders/:orderId/route", c.routeHandler);
  return r;
}
