import type { NextFunction, Request, Response } from "express";
import { AppError, successResponse } from "../../helpers";
import * as Service from "../../services/auditService";
import { auditIdParamSchema } from "../../schemas/auditSchema";
import type {
  ActionsQuerySchema,
  ListAuditLogsQuerySchema,
} from "../../schemas/auditSchema";

type Handler = (req: Request, res: Response) => Promise<void>;

const wrap =
  (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

export const listAuditLogs = wrap(async (req, res) => {
  const filters = res.locals.query as ListAuditLogsQuerySchema;
  const { rows, total } = await Service.listAuditLogs(req.user!, filters);
  successResponse(
    200,
    res,
    {
      logs: rows,
      metadata: {
        current_page: filters.page,
        limit: filters.limit,
        total,
        has_next_page: filters.page * filters.limit < total,
      },
    },
    "Audit logs fetched successfully",
  );
});

export const listAuditActions = wrap(async (req, res) => {
  const actions = await Service.listAuditActions(
    req.user!,
    res.locals.query as ActionsQuerySchema,
  );
  successResponse(200, res, { actions }, "Audit actions fetched successfully");
});

export const getAuditLog = wrap(async (req, res) => {
  const parsed = auditIdParamSchema.safeParse(String(req.params.id));
  if (!parsed.success) throw new AppError(400, "Invalid audit log id");
  const log = await Service.getAuditLog(req.user!, parsed.data);
  successResponse(200, res, { log }, "Audit log fetched successfully");
});
