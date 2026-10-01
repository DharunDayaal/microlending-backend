import { z } from "zod";

export const registerSchema = z.object({
  user_name: z.string().min(1),
  phone_number: z.string().min(6),
  email: z.email().optional(),
  password: z.string().min(8),
  default_upfront_fee_percentage: z.number().min(0).max(100),
  default_interest_percentage: z.number().min(0).max(100),
  default_total_months: z.number().positive(),
});

export const requestOtpSchema = z.object({
  phone_number: z.string().min(6),
  purpose: z.enum(["LOGIN", "RESET_PASSWORD", "VERIFY_PHONE_NUMBER"]),
});

export const verifyOtpSchema = z.object({
  phone_number: z.string().min(6),
  otp_code: z.string().length(6),
  purpose: z.enum(["LOGIN", "RESET_PASSWORD", "VERIFY_PHONE_NUMBER"]),
});

export const loginByEmailSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const loginByPhoneSchema = z.object({
  phone_number: z.string().min(6),
  otp_code: z.string().length(6),
  purpose: z.enum(["LOGIN", "RESET_PASSWORD", "VERIFY_PHONE_NUMBER"]),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1)
})

export type RegisterSchema = z.infer<typeof registerSchema>;
export type RequestOtpSchema = z.infer<typeof requestOtpSchema>;
export type VerifyOtpSchema = z.infer<typeof verifyOtpSchema>;
export type LoginByEmailSchema = z.infer<typeof loginByEmailSchema>;
export type LoginByPhoneSchema = z.infer<typeof loginByPhoneSchema>;
export type RefreshTokenSchema = z.infer<typeof refreshTokenSchema>;