import { Router } from "express";
import { validateQuery } from "../../middleware/validateQuery";
import * as C from "../../controllers/analyticsController";
import {
  employeesQuerySchema,
  forecastQuerySchema,
  geographyQuerySchema,
  limitQuerySchema,
  maturingQuerySchema,
  pagedQuerySchema,
  rangeQuerySchema,
  scopeQuerySchema,
  superForecastQuerySchema,
  superGeographyQuerySchema,
  superLeaderboardQuerySchema,
  superLimitQuerySchema,
  superRangeQuerySchema,
  superSplitTrendQuerySchema,
  superTrendQuerySchema,
  trendQuerySchema,
} from "../../schemas/analyticsSchema";

// mount: app.use("/api/analytics", analyticsRouter)
const analyticsRouter = Router();

// ---- user level (USER, ADMIN, SUPER_ADMIN - scoped by role) ----------------
analyticsRouter.get(
  "/user/overview",
  validateQuery(scopeQuerySchema),
  C.overview,
);
analyticsRouter.get(
  "/user/collections/trend",
  validateQuery(trendQuerySchema),
  C.collectionsTrend,
);
analyticsRouter.get(
  "/user/collections/by-weekday",
  validateQuery(rangeQuerySchema),
  C.collectionsByWeekday,
);
analyticsRouter.get(
  "/user/portfolio/aging",
  validateQuery(scopeQuerySchema),
  C.portfolioAging,
);
analyticsRouter.get(
  "/user/customers/risk",
  validateQuery(pagedQuerySchema),
  C.customerRisk,
);
analyticsRouter.get(
  "/user/forecast/next-weeks",
  validateQuery(forecastQuerySchema),
  C.forecast,
);
analyticsRouter.get(
  "/user/loans/maturing",
  validateQuery(maturingQuerySchema),
  C.maturingLoans,
);
analyticsRouter.get(
  "/user/referrals",
  validateQuery(limitQuerySchema),
  C.referrals,
);

// ---- admin level (ADMIN, SUPER_ADMIN) ---------------------------------------
analyticsRouter.get(
  "/admin/overview",
  validateQuery(scopeQuerySchema),
  C.overview,
);
analyticsRouter.get(
  "/admin/collections/trend",
  validateQuery(trendQuerySchema),
  C.collectionsTrend,
);
analyticsRouter.get(
  "/admin/collections/by-weekday",
  validateQuery(rangeQuerySchema),
  C.collectionsByWeekday,
);
analyticsRouter.get(
  "/admin/portfolio/aging",
  validateQuery(scopeQuerySchema),
  C.portfolioAging,
);
analyticsRouter.get(
  "/admin/portfolio/status",
  validateQuery(scopeQuerySchema),
  C.portfolioStatus,
);
analyticsRouter.get(
  "/admin/disbursements/trend",
  validateQuery(trendQuerySchema),
  C.disbursementTrend,
);
analyticsRouter.get(
  "/admin/earnings/trend",
  validateQuery(trendQuerySchema),
  C.earningsTrend,
);
analyticsRouter.get(
  "/admin/forecast/cashflow",
  validateQuery(forecastQuerySchema),
  C.forecast,
);
analyticsRouter.get(
  "/admin/loans/maturing",
  validateQuery(maturingQuerySchema),
  C.maturingLoans,
);
analyticsRouter.get(
  "/admin/payments/behaviour",
  validateQuery(rangeQuerySchema),
  C.paymentBehaviour,
);
analyticsRouter.get(
  "/admin/customers/risk",
  validateQuery(pagedQuerySchema),
  C.customerRisk,
);
analyticsRouter.get(
  "/admin/customers/repeat",
  validateQuery(scopeQuerySchema),
  C.repeatBorrowers,
);
analyticsRouter.get(
  "/admin/referrals/performance",
  validateQuery(limitQuerySchema),
  C.referrals,
);
analyticsRouter.get(
  "/admin/geography",
  validateQuery(geographyQuerySchema),
  C.geography,
);
analyticsRouter.get(
  "/admin/employees/performance",
  validateQuery(employeesQuerySchema),
  C.employeePerformance,
);
analyticsRouter.get(
  "/admin/employees/:employeeId/summary",
  validateQuery(rangeQuerySchema),
  C.employeeSummary,
);

// ---- super admin level (SUPER_ADMIN only) -----------------------------------
analyticsRouter.get("/super-admin/overview", C.platformOverview);
analyticsRouter.get(
  "/super-admin/admins/performance",
  validateQuery(superRangeQuerySchema),
  C.adminsPerformance,
);
analyticsRouter.get(
  "/super-admin/admins/growth",
  validateQuery(superTrendQuerySchema),
  C.adminsGrowth,
);
analyticsRouter.get(
  "/super-admin/collections/trend",
  validateQuery(superSplitTrendQuerySchema),
  C.platformCollectionsTrend,
);
analyticsRouter.get(
  "/super-admin/earnings/trend",
  validateQuery(superSplitTrendQuerySchema),
  C.platformEarningsTrend,
);
analyticsRouter.get("/super-admin/portfolio/aging", C.platformAging);
analyticsRouter.get(
  "/super-admin/risk/concentration",
  validateQuery(superLimitQuerySchema),
  C.riskConcentration,
);
analyticsRouter.get(
  "/super-admin/employees/leaderboard",
  validateQuery(superLeaderboardQuerySchema),
  C.employeeLeaderboard,
);
analyticsRouter.get(
  "/super-admin/geography",
  validateQuery(superGeographyQuerySchema),
  C.platformGeography,
);
analyticsRouter.get("/super-admin/accounts/summary", C.accountsSummary);
analyticsRouter.get(
  "/super-admin/forecast/cashflow",
  validateQuery(superForecastQuerySchema),
  C.platformForecast,
);

export default analyticsRouter;
