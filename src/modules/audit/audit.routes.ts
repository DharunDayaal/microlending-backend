import { Router } from "express";
import { validateQuery } from "../../shared/middleware/validateQuery";
import * as C from "./audit.controller";
import {
  actionsQuerySchema,
  listAuditLogsQuerySchema,
} from "./audit.schema";

const auditRouter = Router();

auditRouter.get("/", validateQuery(listAuditLogsQuerySchema), C.listAuditLogs);
// keep /actions above /:id
auditRouter.get("/actions", validateQuery(actionsQuerySchema), C.listAuditActions);
auditRouter.get("/:id", C.getAuditLog);

export default auditRouter;