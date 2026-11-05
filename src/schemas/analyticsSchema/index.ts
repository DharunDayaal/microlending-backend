import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const scopeShape = {
  // SUPER_ADMIN only (ignored for ADMIN / USER)
  admin_id: uuid.optional(),
  // ADMIN / SUPER_ADMIN: restrict to one employee's customers
  employee_id: uuid.optional(),
};

const rangeShape = {
  from: isoDate.optional(),
  to: isoDate.optional(),
};

const groupBy = z.enum(["day", "week", "month"]).default("week");
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

/** from <= to and at most 366 days apart (only checked when both are given). */
function withRange<T extends z.ZodType<{ from?: string; to?: string }>>(
  schema: T,
) {
  return schema.refine(
    (v) => {
      if (!v.from || !v.to) return true;
      const a = Date.parse(v.from);
      const b = Date.parse(v.to);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return a <= b && (b - a) / 86_400_000 <= 366;
    },
    { message: "`from` must be on or before `to`, within 366 days" },
  );
}

// ---- admin / user level ----------------------------------------------------
export const scopeQuerySchema = z.object({ ...scopeShape });
export const rangeQuerySchema = withRange(
  z.object({ ...scopeShape, ...rangeShape }),
);
export const trendQuerySchema = withRange(
  z.object({ ...scopeShape, ...rangeShape, group_by: groupBy }),
);
export const forecastQuerySchema = z.object({
  ...scopeShape,
  weeks: z.coerce.number().int().min(1).max(26).default(8),
});
export const maturingQuerySchema = z.object({
  ...scopeShape,
  days: z.coerce.number().int().min(1).max(90).default(14),
  page,
  limit,
});
export const pagedQuerySchema = z.object({ ...scopeShape, page, limit });
export const limitQuerySchema = z.object({
  ...scopeShape,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const geographyQuerySchema = z.object({
  ...scopeShape,
  level: z.enum(["district", "city"]).default("district"),
});
export const employeesQuerySchema = withRange(
  z.object({ ...scopeShape, ...rangeShape, page, limit }),
);

// ---- super admin level -----------------------------------------------------
export const superRangeQuerySchema = withRange(z.object({ ...rangeShape }));
export const superTrendQuerySchema = withRange(
  z.object({ ...rangeShape, group_by: groupBy }),
);
export const superSplitTrendQuerySchema = withRange(
  z.object({
    ...rangeShape,
    group_by: groupBy,
    split_by_admin: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  }),
);
export const superLeaderboardQuerySchema = withRange(
  z.object({ ...rangeShape, page, limit }),
);
export const superLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const superGeographyQuerySchema = z.object({
  level: z.enum(["district", "city"]).default("district"),
});
export const superForecastQuerySchema = z.object({
  admin_id: uuid.optional(),
  weeks: z.coerce.number().int().min(1).max(26).default(8),
});

export type ScopeQuery = z.infer<typeof scopeQuerySchema>;
export type RangeQuery = {
  admin_id?: string;
  employee_id?: string;
  from?: string;
  to?: string;
};
export type TrendQuery = RangeQuery & { group_by: "day" | "week" | "month" };
export type ForecastQuery = z.infer<typeof forecastQuerySchema>;
export type MaturingQuery = z.infer<typeof maturingQuerySchema>;
export type PagedQuery = z.infer<typeof pagedQuerySchema>;
export type LimitQuery = z.infer<typeof limitQuerySchema>;
export type GeographyQuery = z.infer<typeof geographyQuerySchema>;
export type EmployeesQuery = RangeQuery & { page: number; limit: number };
export type SuperRangeQuery = { from?: string; to?: string };
export type SuperTrendQuery = SuperRangeQuery & {
  group_by: "day" | "week" | "month";
};
export type SuperSplitTrendQuery = SuperTrendQuery & {
  split_by_admin: boolean;
};
export type SuperLeaderboardQuery = SuperRangeQuery & {
  page: number;
  limit: number;
};
export type SuperLimitQuery = z.infer<typeof superLimitQuerySchema>;
export type SuperGeographyQuery = z.infer<typeof superGeographyQuerySchema>;
export type SuperForecastQuery = z.infer<typeof superForecastQuerySchema>;
