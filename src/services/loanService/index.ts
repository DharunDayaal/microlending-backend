import { withTransaction } from "../../config/database";
import {
  PG_FOREIGN_KEY_VIOLATION_ERROR_CODE,
  PG_UNIQUE_VIOLATION_ERROR_CODE,
} from "../../constants";
import { AppError } from "../../helpers";
import * as LoanRepository from "../../repositories/loanRepo";
import { findCustomerAccessInfoRepo } from "../../repositories/userRepo";
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

async function assertLoanAccess(
  loan: Loan,
  user: RequestingUser,
): Promise<void> {
  if (user.role === "SUPER_ADMIN") return;
  if (loan.owning_admin_id !== user.teamId) {
    throw new AppError(403, "You don't have access to this loan");
  }
  // employees see every loan (whoever issued it) of customers they created
  if (user.role === "USER") {
    const customer = await findCustomerAccessInfoRepo(loan.customer_id);
    if (!customer || customer.created_by !== user.id) {
      throw new AppError(403, "You don't have access to this loan");
    }
  }
}

/** Scope applied to list-style queries. */
function getLoanScope(user: RequestingUser): {
  owningAdminId?: string;
  createdBy?: string; // customers.created_by
} {
  return {
    owningAdminId: user.role === "SUPER_ADMIN" ? undefined : user.teamId,
    createdBy: user.role === "USER" ? user.id : undefined,
  };
}

function deriveIsOverdue(
  loan: Pick<Loan, "status" | "issued_at" | "total_weeks">,
  outstandingBalance: number,
): boolean {
  if (outstandingBalance <= 0) return false;
  if (loan.status === "OVERDUE") return true; // flipped by the nightly job or by collectPayment
  // Fallback for the gap between the term ending and the next cron run
  return loan.status === "ACTIVE" && isPastDue(loan as Loan);
}

const TERMINAL_STATUSES: LoanStatus[] = ["PAID_OFF", "CLOSED", "DEFAULTED"];

// ACTIVE / OVERDUE are system-controlled (nightly job + collectPayment)
const MANUAL_STATUSES: LoanStatus[] = ["DEFAULTED", "CLOSED"];

export async function isCustomerLoanActive(
  customerId: string,
): Promise<boolean> {
  const loan = await LoanRepository.findActiveLoanByCustomerIdRepo(customerId);
  return loan !== null;
}

/**
 * Checks the caller may issue a loan to this customer and returns the
 * customer's owning_admin_id (the loan inherits it).
 * ADMIN: customer must be in their team. USER: customer must be one they created.
 */
export async function assertCanIssueLoan(
  customerId: string,
  user: RequestingUser,
): Promise<string> {
  const customer = await findCustomerAccessInfoRepo(customerId);
  if (!customer) throw new AppError(404, "Customer not found");
  if (user.role !== "SUPER_ADMIN" && customer.owning_admin_id !== user.teamId) {
    throw new AppError(403, "You don't have access to this customer");
  }
  if (user.role === "USER" && customer.created_by !== user.id) {
    throw new AppError(
      403,
      "You can only issue loans to customers you created",
    );
  }
  return customer.owning_admin_id;
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
    if (amountPaid <= 0) {
      throw new AppError(400, "Amount paid must be a positive number");
    }

    const loan = await LoanRepository.findLoanByIdForUpdateRepo(client, loanId);
    if (!loan) {
      throw new AppError(404, "Loan not found");
    }
    await assertLoanAccess(loan, user);

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
  await assertLoanAccess(loan, user);

  const outstandingBalance = loan.total_payable_amount - loan.total_collected;

  return {
    ...loan,
    outstanding_amount: outstandingBalance,
    is_overdue: deriveIsOverdue(loan, outstandingBalance),
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
  const scope = getLoanScope(user);
  const scopedFilters: ListLoansFilters = {
    ...filters,
    owning_admin_id: scope.owningAdminId,
    customer_created_by: scope.createdBy,
  };
  const { rows, total } = await LoanRepository.listLoansRepo(scopedFilters);

  const withOverdue = rows.map((row) => ({
    ...row,
    is_overdue: deriveIsOverdue(
      row,
      row.total_payable_amount - row.total_collected,
    ),
  }));

  return { rows: withOverdue, total };
}

export async function listTracks(
  loanId: string,
  user: RequestingUser,
): Promise<RepaymentTrackResponse[]> {
  const loan = await LoanRepository.findLoanByIdRepo(loanId);
  if (!loan) throw new AppError(404, "Loan not found");
  await assertLoanAccess(loan, user);
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
  await assertLoanAccess(loan, user);

  const isReopen = status === "ACTIVE";
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  if (isReopen && !isAdmin) {
    throw new AppError(403, "Only admins can reopen a loan");
  }
  if (!isReopen && !MANUAL_STATUSES.includes(status)) {
    throw new AppError(
      400,
      "Status can only be set to ACTIVE, DEFAULTED or CLOSED manually",
    );
  }
  if (loan.status === status) {
    throw new AppError(400, `Loan is already ${status.toLowerCase()}`);
  }

  if (isReopen) {
    if (loan.status !== "DEFAULTED" && loan.status !== "CLOSED") {
      throw new AppError(
        400,
        "Only a defaulted or closed loan can be reopened",
      );
    }
    const totals = await LoanRepository.getLoanTotalsRepo(loanId);
    if (totals.total_collected >= loan.total_payable_amount) {
      throw new AppError(400, "A fully repaid loan cannot be reopened");
    }
  } else {
    if (loan.status === "CLOSED") {
      throw new AppError(400, "A closed loan cannot be changed");
    }
    if (loan.status === "PAID_OFF" && status !== "CLOSED") {
      throw new AppError(400, "A paid-off loan can only be moved to CLOSED");
    }
  }

  try {
    return await withTransaction(async (client) => {
      await LoanRepository.updateLoanStatusRepo(client, loanId, status);

      if (isReopen) {
        await LoanRepository.clearLoanClosedAtRepo(client, loanId);
        return { ...loan, status, closed_at: null };
      }

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
  } catch (error) {
    // partial unique index: one ACTIVE/OVERDUE loan per customer
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(400, "Customer already has another active loan");
    }
    throw error;
  }
}

export async function listCollectionsDue(
  user: RequestingUser,
  preferredPaymentDay?: Weekday,
  page = 1,
  limit = 20,
): Promise<{
  rows: CollectionDueLoan[];
  total: number;
  summary: {
    total_customers: number;
    active_loans: number;
    overdue_loans: number;
    referred_customers: number;
  };
}> {
  const { rows, total, summary } = await LoanRepository.listCollectionsDueRepo(
    page,
    limit,
    preferredPaymentDay,
    getLoanScope(user),
  );

  const mappedRows = rows.map((loan) => {
    const outstandingBalance = loan.total_payable_amount - loan.total_collected;
    return {
      ...loan,
      outstanding_amount: outstandingBalance,
      is_overdue: deriveIsOverdue(loan, outstandingBalance),
    };
  });

  return { rows: mappedRows, total, summary };
}

export async function listPayments(
  loanId: string,
  page: number,
  limit: number,
  user: RequestingUser,
) {
  const loan = await LoanRepository.findLoanByIdRepo(loanId);
  if (!loan) throw new AppError(404, "Loan not found");
  await assertLoanAccess(loan, user);
  return LoanRepository.listPaymentsByLoanIdRepo(loanId, page, limit);
}
