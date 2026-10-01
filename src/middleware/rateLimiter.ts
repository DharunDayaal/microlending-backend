import rateLimit from "express-rate-limit";


export const apiRateLimitConfig = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});