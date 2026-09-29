import type { Request, Response, NextFunction } from "express";
import z from "zod";
import { failureResponse } from "../helpers";

export function validateQuery(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(", ");
      failureResponse(400, res, message);
      return;
    }
    res.locals.query = result.data;
    next();
  };
}