import * as ReportRepository from "../../repositories/reportRepo";
import { RequestingUser } from "../../types/authTypes";
import { CashOutstandingReport, EarningsReport } from "../../types/reportTypes";

/**
 * SUPER_ADMIN: everything. ADMIN: their team (loans.owning_admin_id).
 * USER: loans of customers they created (customers.created_by).
 */
function getReportScope(user: RequestingUser): ReportRepository.ReportScope {
  return {
    owningAdminId: user.role === "SUPER_ADMIN" ? undefined : user.teamId,
    createdBy: user.role === "USER" ? user.id : undefined,
  };
}

export async function getCashOutstanding(
  user: RequestingUser,
): Promise<CashOutstandingReport> {
  const totals = await ReportRepository.getCashOutstandingTotalsRepo(
    getReportScope(user),
  );

  return {
    ...totals,
    outstanding_receivable: totals.total_payable - totals.total_collected,
  };
}

export async function getEarnings(
  user: RequestingUser,
): Promise<EarningsReport> {
  const totals = await ReportRepository.getEarningsTotalsRepo(
    getReportScope(user),
  );

  return {
    ...totals,
    total_earned: totals.fees_earned + totals.interest_earned,
  };
}

export async function getOverdueLoans(
  page: number,
  limit: number,
  user: RequestingUser,
) {
  return ReportRepository.getOverdueLoans(page, limit, getReportScope(user));
}
