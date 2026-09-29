import { Loan } from "./loanTypes";

/**
 * This interface represents the cash outstanding report for a given period.
 * It provides a summary of the active loans, total disbursed amount, total payable amount,
 * total collected amount, and the outstanding receivable amount.
 *
 * @interface CashOutstandingReport
 * @property {number} active_loans - The number of active loans.
 * @property {number} total_disbursed - The total amount disbursed to users (nominal_amount - upfront_fee).
 * @property {number} total_payable - The total amount payable by users (total_payable_amount + interest).
 * @property {number} total_collected - The total amount collected from users (sum of all payments).
 * @property {number} outstanding_receivable - The total amount yet to be collected from users (total_payable - total_collected).
 */
export interface CashOutstandingReport {
  active_loans: number;
  total_disbursed: number;
  total_payable: number;
  total_collected: number;
  outstanding_receivable: number;
}

/**
 * This interface represents the earnings report for a given period.
 * It provides a summary of the fees earned, interest earned, interest expected,
 * and the total earnings.
 *
 * @interface EarningsReport
 * @property {number} fees_earned - The total fees earned from users the moment loan is issued (upfront_fee).
 * @property {number} interest_earned - The total interest earned from users per loan (collected - nominal_amount).
 * @property {number} interest_expected - The total interest expected from users (sum of all interest amounts).
 * @property {number} total_earned - The total earnings from users (fees_earned + interest_earned).
 */
export interface EarningsReport {
  fees_earned: number;
  interest_earned: number;
  interest_expected: number;
  total_earned: number;
}

export interface OverdueLoanRow extends Loan {
  user_name: string;
  phone_number: string;
  total_collected: number;
  outstanding_amount: number;
  days_past_due: number;
}