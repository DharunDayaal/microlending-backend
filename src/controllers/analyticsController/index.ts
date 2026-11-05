import type { NextFunction, Request, Response } from "express";
import { AppError, successResponse } from "../../helpers";
import * as Service from "../../services/analyticsService";
import type {
  EmployeesQuery,
  ForecastQuery,
  GeographyQuery,
  LimitQuery,
  MaturingQuery,
  PagedQuery,
  RangeQuery,
  ScopeQuery,
  SuperForecastQuery,
  SuperGeographyQuery,
  SuperLeaderboardQuery,
  SuperLimitQuery,
  SuperRangeQuery,
  SuperSplitTrendQuery,
  SuperTrendQuery,
  TrendQuery,
} from "../../schemas/analyticsSchema";

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Wraps a handler: success -> 200 JSON, errors -> next(). */
const handle =
  (message: string, fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req, res);
      successResponse(200, res, data, message);
    } catch (error) {
      next(error);
    }
  };

// validateQuery stores the parsed query in res.locals.query (Express 5)
const q = <T>(res: Response) => res.locals.query as T;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- shared by /user/* and /admin/* ---------------------------------------
export const overview = handle("Overview fetched successfully", (req, res) =>
  Service.getOverview(req.user!, q<ScopeQuery>(res)),
);
export const collectionsTrend = handle(
  "Collections trend fetched successfully",
  (req, res) => Service.getCollectionsTrend(req.user!, q<TrendQuery>(res)),
);
export const collectionsByWeekday = handle(
  "Collections by weekday fetched successfully",
  (req, res) => Service.getCollectionsByWeekday(req.user!, q<RangeQuery>(res)),
);
export const portfolioAging = handle(
  "Portfolio aging fetched successfully",
  (req, res) => Service.getAging(req.user!, q<ScopeQuery>(res)),
);
export const customerRisk = handle(
  "Customer risk fetched successfully",
  (req, res) => Service.getCustomerRisk(req.user!, q<PagedQuery>(res)),
);
export const forecast = handle("Forecast fetched successfully", (req, res) =>
  Service.getForecast(req.user!, q<ForecastQuery>(res)),
);
export const maturingLoans = handle(
  "Maturing loans fetched successfully",
  (req, res) => Service.getMaturing(req.user!, q<MaturingQuery>(res)),
);
export const referrals = handle("Referrals fetched successfully", (req, res) =>
  Service.getReferralPerformance(req.user!, q<LimitQuery>(res)),
);

// ---- admin only -------------------------------------------------------------
export const portfolioStatus = handle(
  "Status breakdown fetched successfully",
  (req, res) => Service.getStatusBreakdown(req.user!, q<ScopeQuery>(res)),
);
export const disbursementTrend = handle(
  "Disbursement trend fetched successfully",
  (req, res) => Service.getDisbursementTrend(req.user!, q<TrendQuery>(res)),
);
export const earningsTrend = handle(
  "Earnings trend fetched successfully",
  (req, res) => Service.getEarningsTrend(req.user!, q<TrendQuery>(res)),
);
export const paymentBehaviour = handle(
  "Payment behaviour fetched successfully",
  (req, res) => Service.getPaymentBehaviour(req.user!, q<RangeQuery>(res)),
);
export const repeatBorrowers = handle(
  "Repeat borrowers fetched successfully",
  (req, res) => Service.getRepeatBorrowers(req.user!, q<ScopeQuery>(res)),
);
export const geography = handle("Geography fetched successfully", (req, res) =>
  Service.getGeography(req.user!, q<GeographyQuery>(res)),
);
export const employeePerformance = handle(
  "Employee performance fetched successfully",
  (req, res) =>
    Service.getEmployeePerformance(req.user!, q<EmployeesQuery>(res)),
);
export const employeeSummary = handle(
  "Employee summary fetched successfully",
  (req, res) => {
    const employeeId = String(req.params.employeeId);
    if (!UUID_RE.test(employeeId)) {
      throw new AppError(400, "Invalid employee id");
    }
    return Service.getEmployeeSummary(
      req.user!,
      employeeId,
      q<RangeQuery>(res),
    );
  },
);

// ---- super admin only -------------------------------------------------------
export const platformOverview = handle(
  "Platform overview fetched successfully",
  (req) => Service.getPlatformOverview(req.user!),
);
export const adminsPerformance = handle(
  "Admin performance fetched successfully",
  (req, res) =>
    Service.getAdminsPerformance(req.user!, q<SuperRangeQuery>(res)),
);
export const adminsGrowth = handle(
  "Admin growth fetched successfully",
  (req, res) => Service.getAdminsGrowth(req.user!, q<SuperTrendQuery>(res)),
);
export const platformCollectionsTrend = handle(
  "Platform collections trend fetched successfully",
  (req, res) =>
    Service.getPlatformCollectionsTrend(
      req.user!,
      q<SuperSplitTrendQuery>(res),
    ),
);
export const platformEarningsTrend = handle(
  "Platform earnings trend fetched successfully",
  (req, res) =>
    Service.getPlatformEarningsTrend(req.user!, q<SuperSplitTrendQuery>(res)),
);
export const platformAging = handle(
  "Platform aging fetched successfully",
  (req) => Service.getPlatformAging(req.user!),
);
export const riskConcentration = handle(
  "Risk concentration fetched successfully",
  (req, res) =>
    Service.getRiskConcentration(req.user!, q<SuperLimitQuery>(res)),
);
export const employeeLeaderboard = handle(
  "Employee leaderboard fetched successfully",
  (req, res) =>
    Service.getEmployeeLeaderboard(req.user!, q<SuperLeaderboardQuery>(res)),
);
export const platformGeography = handle(
  "Platform geography fetched successfully",
  (req, res) =>
    Service.getPlatformGeography(req.user!, q<SuperGeographyQuery>(res)),
);
export const accountsSummary = handle(
  "Accounts summary fetched successfully",
  (req) => Service.getAccountsSummary(req.user!),
);
export const platformForecast = handle(
  "Platform forecast fetched successfully",
  (req, res) =>
    Service.getPlatformForecast(req.user!, q<SuperForecastQuery>(res)),
);
