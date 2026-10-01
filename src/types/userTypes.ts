import { LoanStatus } from "./loanTypes";

export type Week = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface User {
  id: string;
  customer_name: string;
  phone_number: string;
  referred_by_id: string | null;
  preferred_payment_day: Week;
  created_at: Date;
  updated_at: Date;
}

export interface GetUsersOnWeekdayPayload {
  page: number;
  limit: number;
  startIndex: number;
  weekday: Week;
  search?: string;
}

export interface UpdateUserPayload {
  customer_name?: string;
  phone_number?: string;
  preferred_payment_day?: Week;
}

export interface ListUsersFilters {
  search?: string;
  page: number;
  limit: number;
}

export interface UserLoanRow {
  loan_id: string | null;
  customer_id: string | null;
  issued_by_admin_id: string | null;
  nominal_amount: number | null;
  upfront_fee: number | null;
  disbursed_amount: number | null;
  total_payable_amount: number | null;
  weekly_payable_amount: number | null;
  total_months: number | null;
  total_weeks: number | null;
  status: LoanStatus | null;
  issued_at: Date | null;
}