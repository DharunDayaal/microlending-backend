import type { Response } from "express";

export function successResponse(
  statusCode: number,
  res: Response,
  data: unknown,
  message: string,
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function failureResponse(
  statusCode: number,
  res: Response,
  message: string,
) {
  return res.status(statusCode).json({
    success: false,
    message,
  });
}
