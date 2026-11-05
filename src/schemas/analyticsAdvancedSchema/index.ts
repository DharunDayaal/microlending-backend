import { z } from "zod";
import {
  rangeQuerySchema,
  scopeQuerySchema,
} from "../../schemas/analyticsSchema";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

// period vs previous period of the same length (default: last 30 days)
export const compareQuerySchema = rangeQuerySchema;

export const insightsQuerySchema = scopeQuerySchema;

export const calendarQuerySchema = scopeQuerySchema.extend({
  month: month.optional(), // default: current month (IST)
});

export const cohortsQuerySchema = scopeQuerySchema.extend({
  months: z.coerce.number().int().min(1).max(24).default(6),
  weeks: z.coerce.number().int().min(4).max(26).default(12),
});

export type CompareQuery = z.infer<typeof compareQuerySchema>;
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type CohortsQuery = z.infer<typeof cohortsQuerySchema>;
