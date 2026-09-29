import type { Request, Response, NextFunction } from "express";
import z from "zod";
import { failureResponse } from "../helpers";

export function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => issue.message)
        .join(", ");

      failureResponse(400, res, message);
    } else {
      req.body = result.data;
      next();
    }
  };
}
