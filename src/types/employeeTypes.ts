export type EmployeeStatus = "pending" | "active" | "inactive";

export interface EmployeeRow {
  id: string;
  user_name: string;
  phone_number: string;
  email: string | null;
  role: "USER";
  is_verified: boolean;
  is_active: boolean;
  admin_id: string;
  admin_name: string | null;
  /** true when the employee has its own loan defaults (otherwise inherits the admin's) */
  has_own_defaults: boolean;
  status: EmployeeStatus;
  created_at: string;
  updated_at: string;
}

export interface EmployeeListRow extends EmployeeRow {
  customers_count: number;
}

export interface EmployeeDetail extends EmployeeListRow {
  active_loans: number;
  overdue_loans: number;
}

export interface ListEmployeesFilters {
  adminId?: string;
  status?: EmployeeStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface CreateEmployeePayload {
  user_name: string;
  phone_number: string;
  email?: string;
  password_hash: string;
  admin_id: string;
  default_upfront_fee_percentage: number;
  default_interest_percentage: number;
  default_total_months: number;
  default_total_weeks: number;
}