import { z } from "zod";

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const withinDays = (max: number) => (v: { from: string; to: string }) => {
  const a = Date.parse(v.from);
  const b = Date.parse(v.to);
  return (
    !Number.isNaN(a) &&
    !Number.isNaN(b) &&
    a <= b &&
    (b - a) / 86_400_000 <= max
  );
};
const rangeMsg = (max: number) => ({
  message: `\`from\` must be on or before \`to\`, within ${max} days`,
});

/** from/to required, at most `max` days apart */
const range = (max: number) =>
  z
    .object({
      from: isoDate,
      to: isoDate,
      admin_id: uuid.optional(), // SUPER_ADMIN only; ignored for ADMIN
      employee_id: uuid.optional(), // customers created by this employee
    })
    .refine(withinDays(max), rangeMsg(max));

const scopeOnly = z.object({
  admin_id: uuid.optional(),
  employee_id: uuid.optional(),
});

// "monday" and "Monday" are accepted too
const weekday = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z.enum([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]),
  );

const loanStatus = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(["ACTIVE", "OVERDUE", "DEFAULTED", "PAID_OFF", "CLOSED"]));

const closedStatus = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(["PAID_OFF", "CLOSED", "DEFAULTED"]));

const t = <T extends string, F extends z.ZodType>(
  type: T,
  filters: F,
  defaultFormat: "xlsx" | "pdf" = "xlsx",
) =>
  z.object({
    type: z.literal(type),
    format: z.enum(["xlsx", "csv", "pdf"]).default(defaultFormat),
    filters,
  });

export const createExportSchema = z.discriminatedUnion("type", [
  t("collections", range(366)),
  t("overdue", scopeOnly.default({})),
  t("weekday_sheet", scopeOnly.extend({ weekday }), "pdf"),
  // route sheet: a short window, since it is walked day by day
  t("due_this_week", range(62)),
  t(
    "customer_list",
    scopeOnly.extend({ payment_day: weekday.optional() }).default({}),
  ),
  t(
    "loans_register",
    scopeOnly
      .extend({
        status: loanStatus.optional(),
        issued_from: isoDate.optional(),
        issued_to: isoDate.optional(),
      })
      .refine(
        (v) => !v.issued_from || !v.issued_to || v.issued_from <= v.issued_to,
        { message: "`issued_from` must be on or before `issued_to`" },
      )
      .default({}),
  ),
  t(
    "closed_loans",
    scopeOnly
      .extend({ from: isoDate, to: isoDate, status: closedStatus.optional() })
      .refine(withinDays(366), rangeMsg(366)),
  ),
  t("new_customers", range(366)),
  t(
    "audit_log",
    z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        admin_id: uuid.optional(),
        module: z.string().trim().min(1).max(40).optional(),
        action: z.string().trim().min(1).max(80).optional(),
        actor_id: uuid.optional(),
        entity_type: z.string().trim().min(1).max(40).optional(),
        entity_id: uuid.optional(),
      })
      .refine((v) => !v.from || !v.to || v.from <= v.to, {
        message: "`from` must be on or before `to`",
      })
      .default({}),
  ),
  t(
    "employee_performance",
    z
      .object({ from: isoDate, to: isoDate, admin_id: uuid.optional() })
      .refine(withinDays(366), rangeMsg(366)),
  ),
  t(
    "team_summary",
    z
      .object({ from: isoDate, to: isoDate })
      .refine(withinDays(366), rangeMsg(366)),
  ),
]);

export const exportIdParamSchema = z.uuid();
export type CreateExportSchema = z.infer<typeof createExportSchema>;
