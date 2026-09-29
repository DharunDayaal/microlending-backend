import * as ReportRepository from "../../repositories/reportRepo";
import { CashOutstandingReport, EarningsReport } from "../../types/reportTypes";

export async function getCashOutstanding(): Promise<CashOutstandingReport> {
  const totals = await ReportRepository.getCashOutstandingTotalsRepo();

  return {
    ...totals,
    outstanding_receivable: totals.total_payable - totals.total_collected,
  };
}

export async function getEarnings(): Promise<EarningsReport> {
  const totals = await ReportRepository.getEarningsTotalsRepo();

  return {
    ...totals,
    total_earned: totals.fees_earned + totals.interest_earned,
  }
}

export async function getOverdueLoans() {
  return await ReportRepository.getOverdueLoans();
}