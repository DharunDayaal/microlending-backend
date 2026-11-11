import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const format = z.enum(["xlsx", "csv"]).default("xlsx");

const withinYear = (v: { from: string; to: string }) => {
  const a = Date.parse(v.from);
  const b = Date.parse(v.to);
  return (
    !Number.isNaN(a) &&
    !Number.isNaN(b) &&
    a <= b &&
    (b - a) / 86_400_000 <= 366
  );
};

const collectionsFilters = z
  .object({
    from: isoDate,
    to: isoDate,
    admin_id: uuid.optional(), // SUPER_ADMIN only; ignored for ADMIN
    employee_id: uuid.optional(), // customers created by this employee
  })
  .refine(withinYear, {
    message: "`from` must be on or before `to`, within 366 days",
  });

const overdueFilters = z.object({
  admin_id: uuid.optional(),
  employee_id: uuid.optional(),
});

export const createExportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("collections"),
    format,
    filters: collectionsFilters,
  }),
  z.object({
    type: z.literal("overdue"),
    format,
    filters: overdueFilters.default({}),
  }),
]);

export const exportIdParamSchema = z.string().uuid();
export type CreateExportSchema = z.infer<typeof createExportSchema>;
