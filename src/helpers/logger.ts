import pino from "pino";
import { pinoHttp } from "pino-http";
import { LOG_LEVEL } from "../config/env";

export const logger = pino({
  level: LOG_LEVEL,
});

export const httpLogger = pinoHttp({
  logger,
});
