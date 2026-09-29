import { Loan } from "../types/loanTypes";

export function isPastDue(loan: Loan): boolean {
  const dueDate = new Date(loan.issued_at);
  dueDate.setDate(dueDate.getDate() + loan.total_weeks * 7);
  return new Date() > dueDate;
}