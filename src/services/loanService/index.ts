import { withTransaction } from "../../config/database";
import {
  PG_FOREIGN_KEY_VIOLATION_ERROR_CODE,
  PG_UNIQUE_VIOLATION_ERROR_CODE,
} from "../../constants";
import { AppError } from "../../helpers";
import * as LoanRepository from "../../repositories/loanRepo";
import { RequestingUser } from "../../types/authTypes";
import {
  CollectionDueLoan,
  CreateLoanPayload,
  ListLoansFilters,
  Loan,
  LoanStatus,
  LoanWithSummary,
  RepaymentTrackResponse,
  Weekday,
} from "../../types/loanTypes";
import { isPastDue } from "../../utils";

function assertLoanAccess(loan: Loan, user: RequestingUser): void {
  if (user.role === "SUPER_ADMIN") return;
  if (loan.owning_admin_id !== user.teamId) {
    throw new AppError(403, "You don't have access to this loan");
  }
}

const TERMINAL_STATUSES: LoanStatus[] = ["PAID_OFF", "CLOSED", "DEFAULTED"];

export async function isCustomerLoanActive(
  customerId: string,
): Promise<boolean> {
  const loan = await LoanRepository.findActiveLoanByCustomerIdRepo(customerId);
  return loan !== null;
}

export async function createLoan(payload: CreateLoanPayload): Promise<Loan> {
  try {
    return await LoanRepository.createLoanRepo(payload);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PG_FOREIGN_KEY_VIOLATION_ERROR_CODE) {
      throw new AppError(404, "Customer not found");
    }
    if (code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(400, "Customer already has an active loan");
    }
    throw error;
  }
}

export async function collectPayment(
  loanId: string,
  weekNumber: number,
  amountPaid: number,
  user: RequestingUser,
): Promise<{ track: RepaymentTrackResponse; loan: Loan }> {
  return await withTransaction(async (client) => {
    if (amountPaid < 0) {
      throw new AppError(400, "Amount paid must be a positive number");
    }

    const loan = await LoanRepository.findLoanByIdForUpdateRepo(client, loanId);
    if (!loan) {
      throw new AppError(404, "Loan not found");
    }
    assertLoanAccess(loan, user);

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
      newTotalCollected >= track.target_amount
        ? "PAID"
        : newTotalCollected > 0
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
      user.id,
    );

    const remainingBalance = Math.max(
      updateTrack.target_amount - updateTrack.total_collected,
      0,
    );

    const totalCollectedForLoan =
      await LoanRepository.sumTotalCollectedForLoanRepo(client, loanId);

    let updatedLoan = loan;
    if (totalCollectedForLoan >= loan.total_payable_amount) {
      await LoanRepository.updateLoanStatusRepo(client, loanId, "PAID_OFF");
      await LoanRepository.setLoanClosedAtRepo(client, loanId);
      updatedLoan = { ...loan, status: "PAID_OFF", closed_at: new Date() };
    } else if (loan.status === "ACTIVE" && weekIsPastTerm) {
      await LoanRepository.updateLoanStatusRepo(client, loanId, "OVERDUE");
      updatedLoan = { ...loan, status: "OVERDUE" };
    }

    return {
      track: { ...updateTrack, remaining_balance: remainingBalance },
      loan: updatedLoan,
    };
  });
}

export async function getLoanById(
  id: string,
  user: RequestingUser,
): Promise<LoanWithSummary> {
  const loan = await LoanRepository.findLoanWithDetailsRepo(id);
  if (!loan) {
    throw new AppError(404, "Loan not found");
  }
  assertLoanAccess(loan, user);

  const outstandingBalance = loan.total_payable_amount - loan.total_collected;

  return {
    ...loan,
    outstanding_amount: outstandingBalance,
    is_overdue:
      loan.status === "ACTIVE" && outstandingBalance > 0 && isPastDue(loan),
    tracks: loan.tracks.map((track) => ({
      ...track,
      remaining_balance: Math.max(
        track.target_amount - track.total_collected,
        0,
      ),
    })),
  };
}

export async function listLoans(
  filters: ListLoansFilters,
  user: RequestingUser,
) {
  const scopedFilters =
    user.role === "SUPER_ADMIN"
      ? filters
      : { ...filters, owning_admin_id: user.teamId };
  const { rows, total } = await LoanRepository.listLoansRepo(scopedFilters);

  const withOverdue = rows.map((row) => ({
    ...row,
    is_overdue:
      row.status === "ACTIVE" &&
      row.total_collected < row.total_payable_amount &&
      isPastDue(row),
  }));

  return { rows: withOverdue, total };
}

export async function listTracks(
  loanId: string,
  user: RequestingUser,
): Promise<RepaymentTrackResponse[]> {
  const loan = await LoanRepository.findLoanByIdRepo(loanId);
  if (!loan) throw new AppError(404, "Loan not found");
  assertLoanAccess(loan, user);
  const tracks = await LoanRepository.listTracksByLoanIdRepo(loanId);
  return tracks.map((track) => ({
    ...track,
    remaining_balance: Math.max(track.target_amount - track.total_collected, 0),
  }));
}

export async function updateLoanStatus(
  loanId: string,
  status: LoanStatus,
  user: RequestingUser,
): Promise<Loan> {
  const loan = await LoanRepository.findLoanByIdRepo(loanId);
  if (!loan) throw new AppError(404, "Loan not found");
  assertLoanAccess(loan, user);

  if (loan.status === "PAID_OFF" && status !== "CLOSED") {
    throw new AppError(400, "A paid-off loan can only be moved to CLOSED");
  }
  return withTransaction(async (client) => {
    await LoanRepository.updateLoanStatusRepo(client, loanId, status);
    if (TERMINAL_STATUSES.includes(status) && !loan.closed_at) {
      await LoanRepository.setLoanClosedAtRepo(client, loanId);
    }
    return {
      ...loan,
      status,
      closed_at: TERMINAL_STATUSES.includes(status)
        ? new Date()
        : loan.closed_at,
    };
  });
}

export async function listCollectionsDue(
  user: RequestingUser,
  preferredPaymentDay?: Weekday,
): Promise<CollectionDueLoan[]> {
  const loans = await LoanRepository.listCollectionsDueRepo(
    preferredPaymentDay,
    user.role === "SUPER_ADMIN" ? undefined : user.teamId,
  );

  return loans.map((loan) => {
    const outstandingBalance = loan.total_payable_amount - loan.total_collected;
    return {
      ...loan,
      outstanding_amount: outstandingBalance,
      is_overdue:
        loan.status === "ACTIVE" && outstandingBalance > 0 && isPastDue(loan),
    };
  });
}

export async function listPayments(
  loanId: string,
  page: number,
  limit: number,
  user: RequestingUser,
) {
  const loan = await LoanRepository.findLoanByIdRepo(loanId);
  if (!loan) throw new AppError(404, "Loan not found");
  assertLoanAccess(loan, user);
  return LoanRepository.listPaymentsByLoanIdRepo(loanId, page, limit);
}
