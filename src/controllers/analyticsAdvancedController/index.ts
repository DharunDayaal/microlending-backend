import type { NextFunction, Request, Response } from "express";
import { successResponse } from "../../helpers";
import * as Service from "../../services/analyticsAdvancedService";
import type {
  CalendarQuery,
  CohortsQuery,
  CompareQuery,
  InsightsQuery,
} from "../../schemas/analyticsAdvancedSchema";

type Handler = (req: Request, res: Response) => Promise<unknown>;

const handle =
  (message: string, fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      successResponse(
        200,
        res,
        (await fn(req, res)) as Record<string, unknown>,
        message,
      );
    } catch (error) {
      next(error);
    }
  };

const q = <T>(res: Response) => res.locals.query as T;

export const kpiCompare = handle(
  "KPI comparison fetched successfully",
  (req, res) => Service.getKpiCompare(req.user!, q<CompareQuery>(res)),
);
export const insights = handle("Insights fetched successfully", (req, res) =>
  Service.getInsights(req.user!, q<InsightsQuery>(res)),
);
export const collectionCalendar = handle(
  "Collection calendar fetched successfully",
  (req, res) => Service.getCollectionCalendar(req.user!, q<CalendarQuery>(res)),
);
export const cohorts = handle("Cohorts fetched successfully", (req, res) =>
  Service.getCohorts(req.user!, q<CohortsQuery>(res)),
);
