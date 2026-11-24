import z from "zod";

export const overdueLoansQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type OverdueLoansQuerySchema = z.infer<typeof overdueLoansQuerySchema>;