import express from "express";
import helmet from "helmet";
import cors from "cors";
import { SET_RATE_LIMIT } from "./config/env";
import { AppError } from "./shared/errors/AppError";
import { errorHandler } from "./shared/errors/errorHandler";
import { httpLogger } from "./shared/logger";
import { apiRateLimitConfig } from "./shared/middleware/rateLimiter";
import healthRouter from "./modules/health/health.routes";
import apiRouter from "./routes";

/** Builds the Express app. No listening or DB warm-up here, so tests can import it. */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(httpLogger);

  // before the rate limiter so uptime checks are never throttled
  app.use(healthRouter);

  app.set("trust proxy", 1);
  if (SET_RATE_LIMIT === "true") {
    app.use(apiRateLimitConfig);
  }

  app.use("/api", apiRouter);

  app.use((_req, _res, next) => {
    next(new AppError(404, "Route not found"));
  });
  app.use(errorHandler);

  return app;
}
