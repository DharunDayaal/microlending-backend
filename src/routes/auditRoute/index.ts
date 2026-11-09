import { Router } from "express";
import { validateQuery } from "../../middleware/validateQuery";
import * as C from "../../controllers/auditController";
import {
  actionsQuerySchema,
  listAuditLogsQuerySchema,
} from "../../schemas/auditSchema";

const auditRouter = Router();

auditRouter.get("/", validateQuery(listAuditLogsQuerySchema), C.listAuditLogs);
// keep /actions above /:id
auditRouter.get("/actions", validateQuery(actionsQuerySchema), C.listAuditActions);
auditRouter.get("/:id", C.getAuditLog);

export default auditRouter;