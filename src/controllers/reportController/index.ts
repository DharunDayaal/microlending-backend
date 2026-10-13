import type { Request, Response, NextFunction } from "express";
import * as ReportService from "../../services/reportService";
import { AppError, successResponse } from "../../helpers";
import { OverdueLoansQuerySchema } from "../../schemas/reportSchema";

export async function cashOutstanding(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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
  try {
    const { page, limit } = res.locals.query as OverdueLoansQuerySchema;
    const { rows, total } = await ReportService.getOverdueLoans(page, limit);

    successResponse(
      200,
      res,
      {
        report: rows,
        metadata: {
          current_page: page,
          limit,
          has_next_page: page * limit < total,
        },
      },
      "Overdue loans report fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}
