// place at: src/schemas/profileSchema.ts
import { z } from "zod";

const uuid = z.uuid();
const oneDecimal = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
const decimal1 = (label: string) =>
  z
    .number()
    .refine(oneDecimal, { message: `${label} allows one decimal place` });

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;

export const updateProfileSchema = z
  .object({
    user_name: z
      .string()
      .trim()
      .min(2, "Name needs at least 2 characters")
      .regex(NAME_RE, "Name may contain letters and . ' - only")
      .optional(),
    email: z.email("Enter a valid email").optional(),
  })
  .refine((v) => v.user_name !== undefined || v.email !== undefined, {
    message: "Send user_name or email",
  });

// The new number must already be verified through the existing OTP flow
// (purpose VERIFY_PHONE_NUMBER), exactly like registration.
export const changePhoneSchema = z.object({
  phone_number: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number"),
});

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(8, "Password needs at least 8 characters"),
    refresh_token: z.string().min(1).optional(),
  })
  .refine((v) => v.current_password !== v.new_password, {
    message: "New password must differ from the current one",
    path: ["new_password"],
  });

// Range checks against the live limits happen in the service.
export const updateDefaultsSchema = z
  .object({
    default_upfront_fee_percentage: decimal1("Upfront fee").optional(),
    default_interest_percentage: decimal1("Interest").optional(),
    default_total_months: decimal1("Term").optional(),
  })
  .refine(
    (v) =>
      v.default_upfront_fee_percentage !== undefined ||
      v.default_interest_percentage !== undefined ||
      v.default_total_months !== undefined,
    { message: "Send at least one default to change" },
  );

export const statsQuerySchema = z.object({
  range: z.enum(["week", "month"]).default("week"),
  scope: z.enum(["me", "team", "all"]).default("me"),
  admin_id: uuid.optional(), // SUPER_ADMIN + scope=team
});

export const teamQuerySchema = z.object({ admin_id: uuid.optional() });

export const listAdminsQuerySchema = z.object({
  status: z.enum(["pending", "active", "inactive"]).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const verificationSchema = z.object({ is_verified: z.boolean() });
export const activeSchema = z.object({ is_active: z.boolean() });

const positive = z.number().positive();
export const updateLimitsSchema = z
  .object({
    min_principal: positive.optional(),
    max_principal: positive.optional(),
    min_months: decimal1("Minimum term").pipe(positive).optional(),
    max_months: decimal1("Maximum term").pipe(positive).optional(),
    max_fee_percent: decimal1("Max fee")
      .pipe(z.number().min(0).max(100))
      .optional(),
    max_interest_percent: decimal1("Max interest")
      .pipe(z.number().min(0).max(1000))
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Send at least one limit to change",
  });

export const idParamSchema = uuid;

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>;
export type ChangePhoneSchema = z.infer<typeof changePhoneSchema>;
export type ChangePasswordSchema = z.infer<typeof changePasswordSchema>;
export type UpdateDefaultsSchema = z.infer<typeof updateDefaultsSchema>;
export type StatsQuerySchema = z.infer<typeof statsQuerySchema>;
export type TeamQuerySchema = z.infer<typeof teamQuerySchema>;
export type ListAdminsQuerySchema = z.infer<typeof listAdminsQuerySchema>;
export type UpdateLimitsSchema = z.infer<typeof updateLimitsSchema>;
