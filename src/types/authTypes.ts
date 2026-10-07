export type UserRole = "USER" | "ADMIN" | "SUPER_ADMIN";

export type OtpPurpose = "LOGIN" | "RESET_PASSWORD" | "VERIFY_PHONE_NUMBER";

export interface AccessTokenPayload {
  user_id: string;
  role: UserRole;
  team_id: string;
}

export interface AdminUser {
  id: string;
  user_name: string;
  phone_number: string;
  email: string | null;
  password_hash: string;
  role: UserRole;
  admin_id: string | null;
  is_verified: boolean;
  is_active: boolean;
  default_upfront_fee_percentage: number | null;
  default_interest_percentage: number | null;
  default_total_months: number | null;
  default_total_weeks: number;
  created_at: Date;
  updated_at: Date;
}

export type AdminUserPublic = Omit<AdminUser, "password_hash">;

export interface RegisterAdminPayload {
  user_name: string;
  phone_number: string;
  email?: string;
  password: string;
  default_upfront_fee_percentage: number;
  default_interest_percentage: number;
  default_total_months: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface CreateAdminPayload {
  user_name: string;
  phone_number: string;
  email?: string;
  password_hash: string;
  default_upfront_fee_percentage: number;
  default_interest_percentage: number;
  default_total_months: number;
  default_total_weeks: number;
}

export interface OtpCode {
  id: string;
  phone_number: string;
  otp_hash: string;
  purpose: OtpPurpose;
  attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  consumed_at: Date | null;
  created_at: Date;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface CreateEmployeePayload {
  user_name: string;
  phone_number: string;
  email?: string;
  password_hash: string;
  admin_id: string;
  default_upfront_fee_percentage?: number;
  default_interest_percentage?: number;
  default_total_months?: number;
  default_total_weeks?: number;
}

export interface RequestingUser {
  id: string;
  role: UserRole;
  teamId: string;
}