import express, { type Express } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { requestId } from "./interfaces/http/middleware/request-id.js";
import { userAuth } from "./interfaces/http/middleware/user-auth.js";
import { errorMapper } from "./interfaces/http/middleware/error-mapper.js";
import { trackingRoutes } from "./interfaces/http/routes.js";
import type { TrackingReadController } from "./interfaces/http/controllers/tracking-read-controller.js";
import type { HealthController } from "./interfaces/http/controllers/health-controller.js";
import type { UserJwtVerifier } from "./infrastructure/auth/user-jwt-verifier.js";

export interface AppDeps {
  logger: Logger;
  health: HealthController;
  userJwt: UserJwtVerifier;
  controller: TrackingReadController;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(requestId());
  app.use(
    pinoHttp({
      logger: deps.logger,
      customProps: (req) => ({ requestId: (req as { requestId?: string }).requestId }),
      redact: { paths: ["req.headers.authorization", "req.headers.cookie"], remove: true },
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", deps.health.healthz);
  app.get("/readyz", deps.health.readyz);

  app.use(userAuth(deps.userJwt));
  app.use(trackingRoutes(deps.controller));

  app.use(errorMapper());
  return app;
}
