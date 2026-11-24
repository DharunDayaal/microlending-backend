import { Router } from "express";
import authRouter from "./modules/auth/auth.routes";
import { rbacAuth } from "./modules/auth/rbac.middleware";
import userRouter from "./modules/users/user.routes";
import loanRouter from "./modules/loans/loan.routes";
import reportRouter from "./modules/reports/report.routes";
import analyticsRouter from "./modules/analytics/analytics.routes";
import insightsRouter from "./modules/analytics/insights.routes";
import {
  analyticsCache,
  clearAnalyticsCacheOnWrite,
} from "./modules/analytics/analytics.cache";
import {
  adminsRouter,
  meRouter,
  settingsRouter,
} from "./modules/profile/profile.routes";
import employeeRouter from "./modules/employees/employee.routes";
import auditRouter from "./modules/audit/audit.routes";
import exportRouter, {
  exportWorkerRouter,
} from "./modules/exports/export.routes";

/** Every /api route. Each module owns its router; this file only mounts them. */
const apiRouter = Router();

apiRouter.use(clearAnalyticsCacheOnWrite);

// public (rbacAuth also lets the public auth routes through)
apiRouter.use("/auth", authRouter);
// called by the export queue with its own secret, not a user token
apiRouter.use("/internal/exports", exportWorkerRouter);

apiRouter.use("/users", rbacAuth, userRouter);
apiRouter.use("/loans", rbacAuth, loanRouter);
apiRouter.use("/reports", rbacAuth, reportRouter);
// both analytics routers on one mount so auth runs once, then the response cache
apiRouter.use(
  "/analytics",
  rbacAuth,
  analyticsCache,
  analyticsRouter,
  insightsRouter,
);
apiRouter.use("/me", rbacAuth, meRouter);
apiRouter.use("/admins", rbacAuth, adminsRouter);
apiRouter.use("/settings", rbacAuth, settingsRouter);
apiRouter.use("/employees", rbacAuth, employeeRouter);
apiRouter.use("/audit-logs", rbacAuth, auditRouter);
apiRouter.use("/exports", rbacAuth, exportRouter);

export default apiRouter;
