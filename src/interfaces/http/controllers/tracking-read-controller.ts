import type { Request, Response, NextFunction } from "express";
import type { GetLatestUseCase } from "../../../application/tracking/get-latest.use-case.js";
import type { GetRouteUseCase } from "../../../application/tracking/get-route.use-case.js";
import { OrderId } from "../../../domain/shared/ids.js";
import { orderIdParam, routeQuery } from "../schemas.js";
import { toPointResponse, toRouteResponse } from "../response-mappers.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

export class TrackingReadController {
  constructor(
    private readonly getLatest: GetLatestUseCase,
    private readonly getRoute: GetRouteUseCase,
  ) {}

  latestHandler = wrap(async (req, res) => {
    const { orderId } = orderIdParam.parse(req.params);
    const point = await this.getLatest.execute(OrderId.of(orderId), req.userId!, req.role!);
    res.status(200).json(toPointResponse(point));
  });

  routeHandler = wrap(async (req, res) => {
    const { orderId } = orderIdParam.parse(req.params);
    const { cursor, limit } = routeQuery.parse(req.query);
    const page = await this.getRoute.execute(OrderId.of(orderId), req.userId!, req.role!, limit, cursor ?? null);
    res.status(200).json(toRouteResponse(page));
  });
}
