import type { Request, Response, NextFunction } from "express";
import * as ReportService from "../../services/reportService";
import { AppError, successResponse } from "../../helpers";

export async function cashOutstanding(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.user!.role !== "SUPER_ADMIN") {
    throw new AppError(
      403,
      "You do not have permission to access this resource",
    );
  }
  try {
    const report = await ReportService.getCashOutstanding();

    successResponse(
      200,
      res,
      { report },
      "Cash outstanding report fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function earnings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.user!.role !== "SUPER_ADMIN") {
    throw new AppError(
      403,
      "You do not have permission to access this resource",
    );
  }
  try {
    const report = await ReportService.getEarnings();

    successResponse(
      200,
      res,
      { report },
      "Earnings report fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function overdueLoans(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.user!.role !== "SUPER_ADMIN") {
    throw new AppError(
      403,
      "You do not have permission to access this resource",
    );
  }
  try {
    const report = await ReportService.getOverdueLoans();

    successResponse(
      200,
      res,
      { report },
      "Overdue loans report fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}
