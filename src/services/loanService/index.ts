import { withTransaction } from "../../config/database";
import { AppError } from "../../helpers";
import * as LoanRepository from "../../repositories/loanRepo";
import {
  CollectionDueLoan,
  CreateLoanPayload,
  ListLoansFilters,
  Loan,
  LoanStatus,
  LoanWithSummary,
  RepaymentTrack,
  Weekday,
} from "../../types/loanTypes";
import { isPastDue } from "../../utils";

export async function createLoan(payload: CreateLoanPayload) {
  const result = await LoanRepository.createLoanRepo(payload);

  return result;
}

export async function collectPayment(
  loanId: string,
  weekNumber: number,
  amountPaid: number,
): Promise<{ track: RepaymentTrack; loan: Loan }> {
  return await withTransaction(async (client) => {
    if (amountPaid < 0) {
      throw new AppError(400, "Amount paid must be a positive number");
    }

    const loan = await LoanRepository.findLoanByIdForUpdateRepo(client, loanId);
    if (!loan) {
      throw new AppError(404, "Loan not found");
    }

    if (loan.status !== "ACTIVE" && loan.status !== "OVERDUE") {
      throw new AppError(
        400,
        `Cannot collect payment on a ${loan.status.toLowerCase()} loan`,
      );
    }

    const weekIsPastTerm = weekNumber > loan.total_weeks;
    const track = await LoanRepository.findOrCreateTrackForUpdateRepo(
      client,
      loanId,
      weekNumber,
      loan.weekly_payable_amount,
      weekIsPastTerm,
    );

    const newTotalCollected = track.total_collected + amountPaid;
    const status =
      amountPaid >= track.target_amount
        ? "PAID"
        : amountPaid > 0 && amountPaid < track.target_amount
          ? "PARTIAL"
          : "UNPAID";

    const updateTrack =
      await LoanRepository.updateRepaymentTrackAfterPaymentRepo(
        client,
        track.id,
        newTotalCollected,
        status,
      );

    await LoanRepository.insertPaymentRepo(
      client,
      track.id,
      loanId,
      amountPaid,
    );

    const totalCollectedForLoan =
      await LoanRepository.sumTotalCollectedForLoanRepo(client, loanId);

    let updatedLoan = loan;
    if (totalCollectedForLoan >= loan.total_payable_amount) {
      await LoanRepository.updateLoanStatusRepo(client, loanId, "PAID_OFF");
      updatedLoan = { ...loan, status: "PAID_OFF" };
    } else if (loan.status === "ACTIVE" && weekIsPastTerm) {
      await LoanRepository.updateLoanStatusRepo(client, loanId, "OVERDUE");
      updatedLoan = { ...loan, status: "OVERDUE" };
    }

    return { track: updateTrack, loan: updatedLoan };
  });
}

export async function getLoanById(id: string): Promise<LoanWithSummary> {
  const loan = await LoanRepository.findLoanWithDetails(id);
  if (!loan) {
    throw new AppError(404, "Loan not found");
  }

  const outstandingBalance = loan.total_payable_amount - loan.total_collected;

  return {
    ...loan,
    outstanding_amount: outstandingBalance,
    is_overdue: loan.status === "ACTIVE" && outstandingBalance > 0 && isPastDue(loan),
  };
}

export async function listLoans(filters: ListLoansFilters) {
  const { rows, total } = await LoanRepository.listLoansRepo(filters);

  const withOverdue = rows.map((row) => ({
    ...row,
    is_overdue:
      row.status === "ACTIVE" &&
      row.total_collected < row.total_payable_amount &&
      isPastDue(row),
  }));

  return { rows: withOverdue, total };
}

export async function updateLoanStatus(
  loanId: string,
  status: LoanStatus,
): Promise<Loan> {
  const loan = await LoanRepository.findLoanByIdRepo(loanId);
  if (!loan) {
    throw new AppError(404, "Loan not found");
  }
  return withTransaction(async (client) => {
    await LoanRepository.updateLoanStatusRepo(client, loanId, status);
    return { ...loan, status };
  });
}

export async function listCollectionsDue(preferredPaymentDay?: Weekday): Promise<CollectionDueLoan[]> {
  const loans = await LoanRepository.listCollectionsDueRepo(preferredPaymentDay);

  return loans.map((loan) => {
    const outstandingBalance = loan.total_payable_amount - loan.total_collected;
    return {
      ...loan,
      outstanding_amount: outstandingBalance,
      is_overdue: loan.status === "ACTIVE" && outstandingBalance > 0 && isPastDue(loan),
    };
  });
}

export async function listPayments(
  loanId: string,
  page: number,
  limit: number,
) {
  const [loan, payments] = await Promise.all([
    LoanRepository.findLoanByIdRepo(loanId),
    LoanRepository.listPaymentsByLoanIdRepo(loanId, page, limit),
  ]);

  if (!loan) {
    throw new AppError(404, "Loan not found");
  }

  return payments;
}

