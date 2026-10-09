import { LoanStatus } from "./loanTypes";

export type Week =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface User {
  id: string;
  customer_name: string;
  created_by: string;
  owning_admin_id: string;
  phone_number: string;
  referred_by_id: string | null;
  preferred_payment_day: Week;
  preferred_payment_time: String | null;
  street_name: string | null;
  city: string;
  district: string;
  created_at: Date;
  updated_at: Date;
}

export interface GetUsersOnWeekdayPayload {
  page: number;
  limit: number;
  startIndex: number;
  weekday: Week;
  search?: string;
  owningAdminId?: string;
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
  owning_admin_id: string | null;
  nominal_amount: number | null;
  upfront_fee: number | null;
  disbursed_amount: number | null;
  total_payable_amount: number | null;
  weekly_payable_amount: number | null;
  total_months: number | null;
  total_weeks: number | null;
  status: LoanStatus | null;
  issued_at: Date | null;
  closed_at: Date | null;
}

export interface DashboardSummary {
  totalTarget: number;
  totalCollected: number;
  remainingAmount: number;
  totalBorrowers: number;
  borrowersPending: number;
}

export interface UserWithReferrer extends User {
  referred_by_name: string | null;
  referred_by_standing: "GOOD_STANDING" | "NEEDS_ATTENTION" | null;
}

export interface CreditHistorySummary {
  on_time_count: number;
  delayed_count: number;
  default_count: number;
  total_loans: number;
  on_time_ratio: number;
}

export interface ReferralStats {
  total_referred: number;
  active_referred: number;
  paired_referred: number;
  paired_percentage: number;
}

export interface CustomerProfile extends UserWithReferrer {
  credit_history: CreditHistorySummary;
  referral_stats: ReferralStats;
}
export interface FlatCustomerProfile extends UserWithReferrer {
  on_time_count: string | number;
  delayed_count: string | number;
  default_count: string | number;
  total_loans: string | number;
  on_time_ratio: string | number;
  total_referred: string | number;
  active_referred: string | number;
  paired_referred: string | number;
  paired_percentage: string | number;
}
