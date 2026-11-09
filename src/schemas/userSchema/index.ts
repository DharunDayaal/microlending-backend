import z from "zod";


export const createUserSchema = z.object({
  customer_name: z.string().min(2, "User name is required"),
  phone_number: z.string().min(13, "Phone number is required"),
  referred_by_id: z.uuid("Invalid referring customer id").optional(),
  admin_id: z.string().uuid("Invalid admin id").optional(),                 
  preferred_payment_day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
  created_at: z.date().optional(),
  street_name: z.string().optional(),
  city: z.string().min(1, "City is required"),
  district: z.string().min(1, "District is required"),
});

export const updateUserSchema = z.object({
  customer_name: z.string().min(1).optional(),
  phone_number: z.string().min(6).optional(),
  preferred_payment_day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']).optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});

export type CreateUserSchema = z.infer<typeof createUserSchema>;
export type UpdateUserSchema = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;