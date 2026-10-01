import rateLimit from "express-rate-limit";
import { AppError } from "../helpers";
import type { Request, Response, NextFunction } from "express";

export const apiRateLimitConfig = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(429, "Too many requests, please try again later."));
  },
});
