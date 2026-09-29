import z from "zod";


export const createUserSchema = z.object({
  user_name: z.string().min(2, "User name is required"),
  phone_number: z.string().min(13, "Phone number is required"),
  referred_by_id: z.string().optional(),
  preferred_payment_day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
  created_at: z.date().optional()
});

export const updateUserSchema = z.object({
  user_name: z.string().min(1).optional(),
  phone_number: z.string().min(6).optional(),
  preferred_payment_day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']).optional(),
})

export type CreateUserSchema = z.infer<typeof createUserSchema>;