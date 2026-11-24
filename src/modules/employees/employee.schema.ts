import { z } from "zod";

export const listEmployeesQuerySchema = z.object({
  status: z.enum(["pending", "active", "inactive"]).optional(),
  search: z.string().trim().min(1).optional(),
  admin_id: z.uuid().optional(), // SUPER_ADMIN only; ignored for ADMIN
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const employeeVerificationSchema = z.object({
  is_verified: z.boolean(),
});

export const employeeActiveSchema = z.object({ is_active: z.boolean() });

export const employeeIdParamSchema = z.uuid();

export const createEmployeeSchema = z.object({
  user_name: z.string().min(1),
  phone_number: z.string().min(6),
  email: z.email().optional(),
  password: z.string().min(8),
  admin_id: z.uuid("Invalid admin id").optional(),
  default_upfront_fee_percentage: z.number().min(0).max(100),
  default_interest_percentage: z.number().min(0).max(100),
  default_total_months: z.number().positive(),
});

export type ListEmployeesQuerySchema = z.infer<typeof listEmployeesQuerySchema>;
export type EmployeeVerificationSchema = z.infer<
  typeof employeeVerificationSchema
>;
export type EmployeeActiveSchema = z.infer<typeof employeeActiveSchema>;
export type CreateEmployeeSchema = z.infer<typeof createEmployeeSchema>;
