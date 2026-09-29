import z from "zod";

export const createLoanSchema = z.object({
  user_id: z.string().min(1, "User ID is required"),
  nominal_amount: z.number().min(1, "Nominal amount is required"),
  total_months: z
    .number()
    .min(1, "Total months must be greater than 0")
    .optional(),
  issued_at: z.date().optional(),
});

export const collectPaymentSchema = z.object({
  week_number: z.number().int().positive(),
  amount_paid: z.number().int(),
});

export const listLoansQuerySchema = z.object({
  status: z.enum(["ACTIVE", "OVERDUE", "PAID_OFF", "DEFAULTED"]).optional(),
  user_id: z.uuid().optional(),
  search: z.string().optional(),
  issued_from: z.coerce.date().optional(),
  issued_to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// The PAID_OFF will be handled inside collectPayment, no manual override of status to PAID_OFF is allowed
export const updateLoanStatusSchema = z.object({
  status: z.enum(["ACTIVE", "OVERDUE", "DEFAULTED"]),
});

export const collectionsDueQuerySchema = z.object({
  preferred_payment_day: z
    .enum([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ])
    .optional(),
});

export const listPaymentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
});

export type CreateLoanSchema = z.infer<typeof createLoanSchema>;
export type CollectPaymentSchema = z.infer<typeof collectPaymentSchema>;
export type ListLoansQuerySchema = z.infer<typeof listLoansQuerySchema>;
export type UpdateLoanStatusSchema = z.infer<typeof updateLoanStatusSchema>;
export type CollectionsDueQuerySchema = z.infer<
  typeof collectionsDueQuerySchema
>;
export type ListPaymentsQuerySchema = z.infer<typeof listPaymentsQuerySchema>;
