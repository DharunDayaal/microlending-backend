import type { Request, Response, NextFunction } from "express";
import { AppError, logger } from ".";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.type
    });
  }

  logger.error({ err: error }, "Unexpected error occurred");

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
}
