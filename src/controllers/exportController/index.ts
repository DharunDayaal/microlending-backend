// place at: src/controllers/exportController.ts
import { timingSafeEqual, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { EXPORT_WORKER_SECRET } from "../../config/env";
import { AppError, successResponse } from "../../helpers";
import * as Service from "../../services/exportService";
import {
  cleanupExports,
  runNextExport,
} from "../../services/exportService/exportWorker";
import {
  createExportSchema,
  exportIdParamSchema,
} from "../../schemas/exportSchema";

type Handler = (req: Request, res: Response) => Promise<void>;

const wrap =
  (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

// ---- app-facing (behind rbacAuth) -------------------------------------------
export const createExport = wrap(async (req, res) => {
  const body = createExportSchema.parse(req.body);
  const result = await Service.requestExport(req.user!, body);
  successResponse(
    202,
    res,
    result,
    result.already_running
      ? "This export is already in progress"
      : "Export queued. We'll have it ready shortly",
  );
});

export const listExports = wrap(async (req, res) => {
  const exports = await Service.listMyExports(req.user!);
  successResponse(200, res, { exports }, "Exports fetched successfully");
});

export const getExport = wrap(async (req, res) => {
  const parsed = exportIdParamSchema.safeParse(String(req.params.id));
  if (!parsed.success) throw new AppError(400, "Invalid export id");
  const exportItem = await Service.getExport(req.user!, parsed.data);
  successResponse(
    200,
    res,
    { export: exportItem },
    "Export fetched successfully",
  );
});

// ---- worker-facing (NOT behind rbacAuth; protected by the shared secret) ----
const digest = (s: string) => createHash("sha256").update(s).digest();

export function requireWorkerSecret(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!EXPORT_WORKER_SECRET) {
    return next(new AppError(503, "Export worker is not configured"));
  }
  const sent = String(req.headers["x-worker-secret"] ?? "");
  // compare hashes so length differences do not leak and timingSafeEqual never throws
  if (!timingSafeEqual(digest(sent), digest(EXPORT_WORKER_SECRET))) {
    return next(new AppError(404, "Route not found")); // do not reveal the route exists
  }
  next();
}

export const runWorker = wrap(async (_req, res) => {
  const result = await runNextExport();
  res.status(200).json({ success: true, ...result });
});

export const runCleanup = wrap(async (_req, res) => {
  const result = await cleanupExports();
  res.status(200).json({ success: true, ...result });
});
