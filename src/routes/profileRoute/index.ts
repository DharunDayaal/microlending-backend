// place at: src/routes/profileRoutes.ts
// mount in routes/index.ts:
import { Router } from "express";
import { validateQuery } from "../../middleware/validateQuery";
import * as C from "../../controllers/profileController";
import {
  listAdminsQuerySchema,
  statsQuerySchema,
  teamQuerySchema,
} from "../../schemas/profileSchema";

export const meRouter = Router();
export const adminsRouter = Router();
export const settingsRouter = Router();


meRouter.get("/", C.getMe);
meRouter.patch("/", C.updateMe);
meRouter.post("/phone", C.changePhone);
meRouter.post("/password", C.changePassword);
meRouter.get("/sessions", C.listSessions);
meRouter.delete("/sessions", C.revokeAllSessions);
meRouter.delete("/sessions/:id", C.revokeSession);
meRouter.get("/stats", validateQuery(statsQuerySchema), C.getStats);
meRouter.patch("/defaults", C.updateDefaults);
meRouter.get("/team", validateQuery(teamQuerySchema), C.getTeam);

adminsRouter.get("/", validateQuery(listAdminsQuerySchema), C.listAdmins);
adminsRouter.patch("/:id/verification", C.setAdminVerification);
adminsRouter.patch("/:id/active", C.setAdminActive);

settingsRouter.get("/limits", C.getLimits);
settingsRouter.patch("/limits", C.updateLimits);