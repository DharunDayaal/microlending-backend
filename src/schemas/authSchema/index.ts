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
  purpose: z.enum([
    "LOGIN",
    "RESET_PASSWORD",
    "VERIFY_PHONE_NUMBER",
    "RESEND_OTP",
    "REGISTER",
  ]),
});

export const verifyOtpSchema = z.object({
  phone_number: z.string().min(6),
  otp_code: z.string().length(6),
  purpose: z.enum([
    "LOGIN",
    "RESET_PASSWORD",
    "VERIFY_PHONE_NUMBER",
    "RESEND_OTP",
    "REGISTER",
  ]),
});

export const loginByEmailSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const loginByPhoneSchema = z.object({
  phone_number: z.string().min(6),
  otp_code: z.string().length(6),
  purpose: z.enum([
    "LOGIN",
    "RESET_PASSWORD",
    "VERIFY_PHONE_NUMBER",
    "RESEND_OTP",
    "REGISTER",
  ]),
});

export const resetPasswordSchema = z
  .object({
    email: z.string().email().optional(),
    phone_number: z.string().min(6).optional(),
    new_password: z.string().min(8),
  })
  .refine((data) => !!data.email !== !!data.phone_number, {
    message: "Provide exactly one of email or phone_number",
  });

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export const createEmployeeSchema = z
  .object({
    user_name: z.string().min(1),
    phone_number: z.string().min(6),
    email: z.email().optional(),
    password: z.string().min(8),
    default_upfront_fee_percentage: z.number().min(0).max(100).optional(),
    default_interest_percentage: z.number().min(0).max(100).optional(),
    default_total_months: z.number().positive().optional(),
  })
  .refine(
    (data) => {
      const fields = [
        data.default_upfront_fee_percentage,
        data.default_interest_percentage,
        data.default_total_months,
      ];
      const setCount = fields.filter((f) => f !== undefined).length;
      return setCount === 0 || setCount === fields.length;
    },
    { message: "Provide all three default fields together, or none of them" },
  );

export type RegisterSchema = z.infer<typeof registerSchema>;
export type RequestOtpSchema = z.infer<typeof requestOtpSchema>;
export type VerifyOtpSchema = z.infer<typeof verifyOtpSchema>;
export type LoginByEmailSchema = z.infer<typeof loginByEmailSchema>;
export type LoginByPhoneSchema = z.infer<typeof loginByPhoneSchema>;
export type RefreshTokenSchema = z.infer<typeof refreshTokenSchema>;
export type CreateEmployeeSchema = z.infer<typeof createEmployeeSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
