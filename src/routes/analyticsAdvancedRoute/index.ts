import { Router } from "express";
import { validateQuery } from "../../middleware/validateQuery";
import * as C from "../../controllers/analyticsAdvancedController";
import {
  calendarQuerySchema,
  cohortsQuerySchema,
  compareQuerySchema,
  insightsQuerySchema,
} from "../../schemas/analyticsAdvancedSchema";

const analyticsAdvancedRouter = Router();

// user level (USER, ADMIN, SUPER_ADMIN - scoped by role)
analyticsAdvancedRouter.get(
  "/user/kpis/compare",
  validateQuery(compareQuerySchema),
  C.kpiCompare,
);
analyticsAdvancedRouter.get(
  "/user/insights",
  validateQuery(insightsQuerySchema),
  C.insights,
);
analyticsAdvancedRouter.get(
  "/user/collections/calendar",
  validateQuery(calendarQuerySchema),
  C.collectionCalendar,
);

// admin level (ADMIN, SUPER_ADMIN)
// SUPER_ADMIN without admin_id sees the whole platform.
analyticsAdvancedRouter.get(
  "/admin/kpis/compare",
  validateQuery(compareQuerySchema),
  C.kpiCompare,
);
analyticsAdvancedRouter.get(
  "/admin/insights",
  validateQuery(insightsQuerySchema),
  C.insights,
);
analyticsAdvancedRouter.get(
  "/admin/collections/calendar",
  validateQuery(calendarQuerySchema),
  C.collectionCalendar,
);
analyticsAdvancedRouter.get(
  "/admin/cohorts",
  validateQuery(cohortsQuerySchema),
  C.cohorts,
);

export default analyticsAdvancedRouter;
