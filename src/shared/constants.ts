export const  LOAN_CONFIG = {
  upfrontFeePercent: 5,
  interestPercent: 25,
} as const;

export const PG_FOREIGN_KEY_VIOLATION_ERROR_CODE = "23503";

export const PG_UNIQUE_VIOLATION_ERROR_CODE = "23505";

export const BCRYPT_SALT_ROUNDS = 10;
export const JWT_ACCESS_EXPIRY = "15min";
export const JWT_REFRESH_EXPIRY_DAYS = 30;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 30
export const VERIFIED_OTP_VALID_FOR_MINUTES = 10;
export const DEV_OTP_CODE = "123456";
