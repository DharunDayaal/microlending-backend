import { Week } from "./userTypes";

export type Weekday = Week;

export type LoanStatus =
  | "ACTIVE"
  | "OVERDUE"
  | "PAID_OFF"
  | "DEFAULTED"
  | "CLOSED";

export type PaymentStatus = "UNPAID" | "PAID" | "PARTIAL";

export interface Loan {
  id: string;
  customer_id: string;
  issued_by_admin_id: string;
  owning_admin_id: string;
  nominal_amount: number;
  upfront_fee: number;
  disbursed_amount: number;
  total_payable_amount: number;
  weekly_payable_amount: number;
  total_months: number;
  total_weeks: number;
  status: LoanStatus;
  issued_at: Date;
  closed_at: Date | null;
}

export interface CreateLoanPayload {
  customer_id: string;
  issued_by_admin_id: string;
  owning_admin_id: string;
  nominal_amount: number;
  upfront_fee: number;
  disbursed_amount: number;
  total_payable_amount: number;
  weekly_payable_amount: number;
  total_months: number;
  total_weeks: number;
  issued_at: Date;
}

export interface RepaymentTrack {
  id: string;
  loan_id: string;
  week_number: number;
  total_collected: number;
  target_amount: number;
  status: PaymentStatus;
  is_overdued: boolean;
}

export interface RepaymentTrackResponse extends RepaymentTrack {
  remaining_balance: number;
}

export interface Payment {
  id: string;
  track_id: string;
  loan_id: string;
  amount_paid: number;
  collected_by_admin_id: string;
  paid_at: Date;
}

export interface LoanWithSummary extends Loan {
  total_collected: number;
  outstanding_amount: number;
  paid_weeks: number;
  partial_weeks: number;
  tracks: RepaymentTrackResponse[];
  is_overdue: boolean;
}

export interface ListLoansFilters {
  status?: LoanStatus;
  customer_id?: string;
  owning_admin_id?: string;
  search?: string;
  issued_from?: Date;
  issued_to?: Date;
  page: number;
  limit: number;
}

export interface LoanListRow extends Loan {
  user_name: string;
  phone_number: string;
  total_collected: number;
  total: number;
}

export interface LoanDetailRow extends Loan {
  total_collected: number;
  paid_weeks: number;
  partial_weeks: number;
  tracks: RepaymentTrack[];
}

export interface CollectionDueLoan extends Loan {
  user_name: string;
  phone_number: string;
  preferred_payment_day: Weekday | null;
  total_collected: number;
  outstanding_amount: number;
  is_overdue: boolean;
  tracks: RepaymentTrack[];
}

export interface CollectionDueRow extends Loan {
  user_name: string;
  phone_number: string;
  preferred_payment_day: Weekday | null;
  total_collected: number;
  tracks: RepaymentTrack[];
}

export interface ActiveLoanRow extends Loan {
  user_name: string;
  phone_number: string;
  preferred_payment_day: Weekday | null;
}

export interface PaymentWithWeek extends Payment {
  week_number: number;
}

export interface PaymentListRow extends PaymentWithWeek {
  total: number;
}
