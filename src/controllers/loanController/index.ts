import type { Request, Response, NextFunction } from "express";
import {
  PG_FOREIGN_KEY_VIOLATION_ERROR_CODE,
  LOAN_CONFIG,
  PG_UNIQUE_VIOLATION_ERROR_CODE,
} from "../../constants";
import { AppError, successResponse } from "../../helpers";
import {
  CollectionsDueQuerySchema,
  CollectPaymentSchema,
  CreateLoanSchema,
  ListLoansQuerySchema,
  ListPaymentsQuerySchema,
} from "../../schemas/loanSchema";
import { CreateLoanPayload } from "../../types/loanTypes";
import * as LoanService from "../../services/loanService";

const pecentOf = (amount: number, percent: number) =>
  Math.round((amount * percent) / 100);

const calculateTotalWeeks = (totalMonths: number) =>
  Math.round(totalMonths * 4);

export async function createLoan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { user_id, nominal_amount, issued_at, total_months } =
      req.body as CreateLoanSchema;

    const totalMonths = total_months ?? 2.5;
    const totalWeeks = calculateTotalWeeks(totalMonths);

    const { upfrontFeePercent, interestPercent } = LOAN_CONFIG;

    const upfrontFee = pecentOf(nominal_amount, upfrontFeePercent);
    const disbursedAmount = nominal_amount - upfrontFee;
    const totalPayableAmount =
      nominal_amount + pecentOf(nominal_amount, interestPercent);
    const weeklyPayableAmount = Math.ceil(totalPayableAmount / totalWeeks);

    const payload: CreateLoanPayload = {
      user_id,
      nominal_amount,
      upfront_fee: upfrontFee,
      disbursed_amount: disbursedAmount,
      total_payable_amount: totalPayableAmount,
      weekly_payable_amount: weeklyPayableAmount,
      total_months: totalMonths,
      total_weeks: totalWeeks,
      issued_at: issued_at || new Date(),
    };

    const loan = await LoanService.createLoan(payload);
    successResponse(201, res, { loan }, "Loan created successfully");
  } catch (error) {
    if (
      (error as { code?: string }).code === PG_FOREIGN_KEY_VIOLATION_ERROR_CODE
    ) {
      next(new AppError(400, "User not found"));
    }
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      next(new AppError(400, "User already has an active loan"));
    }
    next(error);
  }
}

export async function collectPayment(
  req: Request<{ loanId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { week_number, amount_paid } = req.body as CollectPaymentSchema;

    const response = await LoanService.collectPayment(
      req.params.loanId,
      week_number,
      amount_paid,
    );

    successResponse(201, res, response, "Payment collected successfully");
  } catch (error) {
    next(error);
  }
}

export async function getLoanById(
  req: Request<{ loanId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const loan = await LoanService.getLoanById(req.params.loanId);
    successResponse(200, res, { loan }, "Loan retrieved successfully");
    ``;
  } catch (error) {
    next(error);
  }
}

export async function listLoans(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const filters = res.locals.query as ListLoansQuerySchema;
    const { rows, total } = await LoanService.listLoans(filters);
    successResponse(
      200,
      res,
      { loans: rows, total, page: filters.page, limit: filters.limit },
      "Loans fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function updateLoanStatus(
  req: Request<{ loanId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { status } = req.body;
    const loan = await LoanService.updateLoanStatus(req.params.loanId, status);
    successResponse(200, res, { loan }, "Loan status updated successfully");
  } catch (error) {
    next(error);
  }
}

export async function collectionsDue(
  req: Request<any, any, any, CollectionsDueQuerySchema>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { preferred_payment_day } = req.query;
    const loans = await LoanService.listCollectionsDue(preferred_payment_day);

    successResponse(
      200,
      res,
      { loans },
      "Collections due fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function listPayments(
  request: Request<{ loanId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { loanId } = request.params;
    const { page, limit } = res.locals.query as ListPaymentsQuerySchema;
    const { rows, total } = await LoanService.listPayments(loanId, page, limit);
    successResponse(
      200,
      res,
      { payments: rows, total, page, limit },
      "Payments fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}
