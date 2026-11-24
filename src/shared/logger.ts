import pino from "pino";
import { pinoHttp } from "pino-http";
import { LOG_LEVEL } from "../config/env";

export const logger = pino({
  level: LOG_LEVEL,
});

export const httpLogger = pinoHttp({
  logger,
  // never write credentials to the logs
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-vercel-oidc-token"]',
      'req.headers["x-vercel-proxy-signature"]',
      "req.headers.forwarded",
      'res.headers["set-cookie"]',
    ],
    censor: "[REDACTED]",
  },
});
