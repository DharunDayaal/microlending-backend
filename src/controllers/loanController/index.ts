import type { Request, Response, NextFunction } from "express";
import {
  PG_FOREIGN_KEY_VIOLATION_ERROR_CODE,
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
import * as AuthRepository from "../../repositories/authRepo";

const percentOf = (amount: number, percent: number) =>
  Math.round((amount * percent) / 100);

const calculateTotalWeeks = (totalMonths: number) =>
  Math.round(totalMonths * 4);

export async function createLoan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const {
      customer_id,
      nominal_amount,
      issued_at,
      total_months,
      upfront_fee_percentage,
      interest_percentage,
    } = req.body as CreateLoanSchema;

    const adminId = req.user!.id;

    const isActive = await LoanService.isCustomerLoanActive(customer_id);
    if (isActive) {
      throw new AppError(400, "Customer already has an active loan");
    }

    const requester = await AuthRepository.findAdminByIdRepo(req.user!.id);
    if (!requester) {
      throw new AppError(404, "Requesting user not found");
    }

    let defaultsSource = requester;
    if (
      requester.role === "USER" &&
      requester.default_upfront_fee_percentage === null
    ) {
      // No personal override — fall back to the admin they belong to.
      const managingAdmin = await AuthRepository.findAdminByIdRepo(
        requester.admin_id!,
      );
      if (!managingAdmin) {
        throw new AppError(404, "Managing admin not found");
      }
      defaultsSource = managingAdmin;
    }

    const feePercent =
      upfront_fee_percentage ?? defaultsSource.default_upfront_fee_percentage!;
    const interestPercent =
      interest_percentage ?? defaultsSource.default_interest_percentage!;
    const months = total_months ?? defaultsSource.default_total_months!;
    const totalWeeks = calculateTotalWeeks(months);

    const upfrontFee = percentOf(nominal_amount, feePercent);
    const disbursedAmount = nominal_amount - upfrontFee;
    const totalPayableAmount =
      nominal_amount + percentOf(nominal_amount, interestPercent);
    const weeklyPayableAmount = Math.ceil(totalPayableAmount / totalWeeks);

    const payload: CreateLoanPayload = {
      customer_id,
      issued_by_admin_id: adminId,
      owning_admin_id: req.user!.teamId,
      nominal_amount,
      upfront_fee: upfrontFee,
      disbursed_amount: disbursedAmount,
      total_payable_amount: totalPayableAmount,
      weekly_payable_amount: weeklyPayableAmount,
      total_months: months,
      total_weeks: totalWeeks,
      issued_at: issued_at ?? new Date(),
    };

    const loan = await LoanService.createLoan(payload);
    successResponse(201, res, { loan }, "Loan created successfully");
  } catch (error) {
    if (
      (error as { code?: string }).code === PG_FOREIGN_KEY_VIOLATION_ERROR_CODE
    ) {
      return next(new AppError(400, "User not found"));
    }
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      return next(new AppError(400, "User already has an active loan"));
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
      req.user!,
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
    const loan = await LoanService.getLoanById(req.params.loanId, req.user!);
    successResponse(200, res, { loan }, "Loan retrieved successfully");
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
    const { rows, total } = await LoanService.listLoans(filters, req.user!);
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
    const user = req.user!;
    const loan = await LoanService.updateLoanStatus(
      req.params.loanId,
      status,
      user,
    );
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
    const loans = await LoanService.listCollectionsDue(
      req.user!,
      preferred_payment_day,
    );

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
    const { rows, total } = await LoanService.listPayments(
      loanId,
      page,
      limit,
      request.user!,
    );
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
