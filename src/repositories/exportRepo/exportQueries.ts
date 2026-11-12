// One definition per export type: who may ask for it, which columns it has, and
// how to read its rows in batches. To add an export, add an entry to EXPORTS.
//
// Batches use keyset paging ("rows after this one"), never OFFSET, so reading
// row 90,000 costs the same as reading row 10. Cursor values are kept as text
// so timestamps keep their full microseconds.
import { getPool } from "../../config/database";
import { renderWeekdaySheet } from "../../utils/exportPdf";
import {
  auditLog,
  employeePerformance,
  teamSummary,
} from "./exportQueriesAdmin";
import {
  closedLoans,
  customerList,
  dueThisWeek,
  loansRegister,
  newCustomers,
} from "./exportQueriesOps";
import type { SheetLoan } from "../../utils/exportPdf";
import type {
  ExportCursor,
  ExportDefinition,
  ExportType,
} from "../../types/exportTypes";

import {
  TODAY,
  TZ,
  loanScopeSql as scopeSql,
  nextCursor,
  req,
  todayIst,
} from "./exportSql";

// ---------------------------------------------------------------------------
// Collections: every payment taken in a date range (IST days, inclusive)
// ---------------------------------------------------------------------------
const PAID_RANGE = `
  p.paid_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
  AND p.paid_at < (($2::date) + 1)::timestamp AT TIME ZONE '${TZ}'`;

const collections: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
  title: "Collections",
  columns: [
    { header: "Date", key: "paid_date", width: 13, kind: "date" },
    { header: "Time", key: "paid_time", width: 10 },
    { header: "Customer", key: "customer_name", width: 28 },
    { header: "Phone", key: "phone_number", width: 17 },
    { header: "Loan", key: "loan_ref", width: 11 },
    { header: "Week", key: "week_number", width: 7, kind: "int" },
    { header: "Amount (Rs)", key: "amount", width: 13, kind: "int" },
    { header: "Collected by", key: "collected_by", width: 24 },
    { header: "Loan status", key: "loan_status", width: 13 },
  ],

  label: (f) => `collections_${req(f, "from")}_to_${req(f, "to")}`,

  async count(scope, f) {
    const values: unknown[] = [req(f, "from"), req(f, "to")];
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n
         FROM payments p
         JOIN loans l ON l.id = p.loan_id
         JOIN customers u ON u.id = l.customer_id
        WHERE ${PAID_RANGE} ${scopeSql(scope, values)}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [req(f, "from"), req(f, "to")];
    let where = `${PAID_RANGE} ${scopeSql(scope, values)}`;
    if (cursor) {
      values.push(cursor.ts, cursor.id);
      where += ` AND (p.paid_at, p.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
    }
    values.push(size);
    const r = await getPool().query(
      `SELECT p.id,
              p.paid_at::text AS cursor_ts,
              (p.paid_at AT TIME ZONE '${TZ}')::date::text AS paid_date,
              to_char(p.paid_at AT TIME ZONE '${TZ}', 'HH12:MI AM') AS paid_time,
              u.customer_name, u.phone_number,
              left(l.id::text, 8) AS loan_ref,
              rt.week_number,
              p.amount_paid::int AS amount,
              COALESCE(NULLIF(cb.user_name, ''), NULLIF(cb.email, ''), cb.phone_number) AS collected_by,
              l.status::text AS loan_status
         FROM payments p
         JOIN loans l ON l.id = p.loan_id
         JOIN customers u ON u.id = l.customer_id
         JOIN repayment_tracks rt ON rt.id = p.track_id
         LEFT JOIN users cb ON cb.id = p.collected_by_admin_id
        WHERE ${where}
        ORDER BY p.paid_at, p.id
        LIMIT $${values.length}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    const last = rows[rows.length - 1];
    const next: ExportCursor =
      rows.length === size && last
        ? { ts: String(last.cursor_ts), id: String(last.id) }
        : null;
    return { rows, next };
  },
};

// ---------------------------------------------------------------------------
// Overdue list: OVERDUE and DEFAULTED loans, with what is late and since when
// ---------------------------------------------------------------------------
const OVERDUE_WEEK = `rt.status <> 'PAID' AND (b.issued_date + rt.week_number * 7) < ${TODAY}`;

const overdue: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN", "USER"],
  title: "Overdue loans",
  columns: [
    { header: "Customer", key: "customer_name", width: 28 },
    { header: "Phone", key: "phone_number", width: 17 },
    { header: "City", key: "city", width: 16 },
    { header: "District", key: "district", width: 16 },
    { header: "Payment day", key: "payment_day", width: 13 },
    { header: "Loan", key: "loan_ref", width: 11 },
    { header: "Status", key: "status", width: 11 },
    { header: "Issued", key: "issued_date", width: 13, kind: "date" },
    { header: "Weeks overdue", key: "weeks_overdue", width: 14, kind: "int" },
    { header: "Days overdue", key: "days_overdue", width: 13, kind: "int" },
    {
      header: "Overdue amount (Rs)",
      key: "overdue_amount",
      width: 19,
      kind: "int",
    },
    { header: "Outstanding (Rs)", key: "outstanding", width: 17, kind: "int" },
    { header: "Last payment", key: "last_payment", width: 13, kind: "date" },
    { header: "Added by", key: "added_by", width: 22 },
  ],

  label: () => `overdue_loans_${todayIst()}`,

  async count(scope) {
    const values: unknown[] = [];
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n
         FROM loans l
         JOIN customers u ON u.id = l.customer_id
        WHERE l.status IN ('OVERDUE','DEFAULTED') ${scopeSql(scope, values)}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, _f, cursor, size) {
    const values: unknown[] = [];
    let where = `l.status IN ('OVERDUE','DEFAULTED') ${scopeSql(scope, values)}`;
    if (cursor) {
      values.push(cursor.id);
      where += ` AND l.id > $${values.length}::uuid`;
    }
    values.push(size);
    const r = await getPool().query(
      `WITH b AS (
         SELECT l.id, l.status, l.total_payable_amount, u.customer_name, u.phone_number,
                u.city, u.district, u.preferred_payment_day, u.created_by,
                (l.issued_at AT TIME ZONE '${TZ}')::date AS issued_date
           FROM loans l
           JOIN customers u ON u.id = l.customer_id
          WHERE ${where}
          ORDER BY l.id
          LIMIT $${values.length}
       )
       SELECT b.id,
              b.customer_name, b.phone_number, b.city, b.district,
              b.preferred_payment_day::text AS payment_day,
              left(b.id::text, 8) AS loan_ref,
              b.status::text AS status,
              b.issued_date::text AS issued_date,
              t.weeks_overdue,
              CASE WHEN t.first_week IS NULL THEN 0
                   ELSE (${TODAY} - (b.issued_date + t.first_week * 7)) END::int AS days_overdue,
              t.overdue_amount,
              (b.total_payable_amount - t.collected)::int AS outstanding,
              lp.last_payment::text AS last_payment,
              COALESCE(NULLIF(emp.user_name, ''), NULLIF(emp.email, ''), emp.phone_number) AS added_by
         FROM b
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE ${OVERDUE_WEEK})::int AS weeks_overdue,
                  COALESCE(SUM(GREATEST(rt.target_amount - rt.total_collected, 0))
                           FILTER (WHERE ${OVERDUE_WEEK}), 0)::int AS overdue_amount,
                  MIN(rt.week_number) FILTER (WHERE ${OVERDUE_WEEK}) AS first_week,
                  COALESCE(SUM(rt.total_collected), 0)::int AS collected
             FROM repayment_tracks rt
            WHERE rt.loan_id = b.id
         ) t ON true
         LEFT JOIN LATERAL (
           SELECT (MAX(p.paid_at) AT TIME ZONE '${TZ}')::date AS last_payment
             FROM payments p WHERE p.loan_id = b.id
         ) lp ON true
         LEFT JOIN users emp ON emp.id = b.created_by
        ORDER BY b.id`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    const last = rows[rows.length - 1];
    const next: ExportCursor =
      rows.length === size && last ? { id: String(last.id) } : null;
    return { rows, next };
  },
};

// ---------------------------------------------------------------------------
// Weekday sheet (PDF only): every customer who pays on one weekday and has an
// ACTIVE or OVERDUE loan, with what was paid in each week up to the current one.
// One row per loan. The PDF cap is small, so it is read in a single batch.
//
// Week 1 runs from the issue date until issue + 7 days, week 2 the next 7 days,
// and so on (same rule as the overdue list). A week with no payment shows 0.
// ---------------------------------------------------------------------------
const WEEKDAY_WHERE = `u.preferred_payment_day::text = $1 AND l.status IN ('ACTIVE', 'OVERDUE')`;

const weekdaySheet: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN", "USER"],
  title: "Weekly collection sheet",
  // Excel and CSV get one row per loan; the PDF has its own block layout (renderPdf)
  columns: [
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "phone_number", width: 16 },
    { header: "Street", key: "street_name", width: 20 },
    { header: "City", key: "city", width: 15 },
    { header: "District", key: "district", width: 15 },
    { header: "Payment day", key: "payment_day", width: 13 },
    { header: "Referred by", key: "referrer_name", width: 24 },
    { header: "Referrer phone", key: "referrer_phone", width: 16 },
    { header: "Referrer city", key: "referrer_city", width: 15 },
    { header: "Loan", key: "loan_ref", width: 10 },
    { header: "Status", key: "status", width: 10 },
    { header: "Issued", key: "issued_date", width: 13, kind: "date" },
    { header: "Current week", key: "current_week", width: 13, kind: "int" },
    { header: "Weeks", key: "total_weeks", width: 8, kind: "int" },
    { header: "Principal (Rs)", key: "nominal_amount", width: 14, kind: "int" },
    { header: "Fee (Rs)", key: "upfront_fee", width: 10, kind: "int" },
    {
      header: "Disbursed (Rs)",
      key: "disbursed_amount",
      width: 14,
      kind: "int",
    },
    {
      header: "Total payable (Rs)",
      key: "total_payable_amount",
      width: 18,
      kind: "int",
    },
    {
      header: "Weekly (Rs)",
      key: "weekly_payable_amount",
      width: 12,
      kind: "int",
    },
    { header: "Paid per week", key: "weeks_text", width: 60 },
  ],
  label: (f) =>
    `collection_sheet_${req(f, "weekday").toLowerCase()}_${todayIst()}`,

  async count(scope, f) {
    const values: unknown[] = [req(f, "weekday")];
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n
         FROM loans l
         JOIN customers u ON u.id = l.customer_id
        WHERE ${WEEKDAY_WHERE} ${scopeSql(scope, values)}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, f, _cursor, size) {
    const values: unknown[] = [req(f, "weekday")];
    const scoped = scopeSql(scope, values);
    values.push(size);
    const r = await getPool().query(
      `WITH b AS (
         SELECT l.id, l.status::text AS status, l.nominal_amount, l.upfront_fee,
                l.disbursed_amount, l.total_payable_amount, l.weekly_payable_amount,
                l.total_months::float8 AS total_months, l.total_weeks,
                (l.issued_at AT TIME ZONE '${TZ}')::date AS issued_date,
                u.customer_name, u.phone_number, u.street_name, u.city, u.district,
                u.preferred_payment_day::text AS payment_day,
                u.referred_by_id, l.owning_admin_id,
                LEAST(l.total_weeks,
                      GREATEST(1, CEIL((${TODAY} - (l.issued_at AT TIME ZONE '${TZ}')::date)::numeric / 7)))::int AS current_week
           FROM loans l
           JOIN customers u ON u.id = l.customer_id
          WHERE ${WEEKDAY_WHERE} ${scoped}
          ORDER BY u.city NULLS LAST, u.customer_name, l.id
          LIMIT $${values.length}
       )
       SELECT left(b.id::text, 8) AS loan_ref, b.status, b.issued_date::text AS issued_date,
              b.nominal_amount, b.upfront_fee, b.disbursed_amount,
              b.total_payable_amount, b.weekly_payable_amount,
              b.total_months, b.total_weeks, b.current_week,
              b.customer_name, b.phone_number, b.street_name, b.city, b.district, b.payment_day,
              -- a referrer from another team is never shown
              ref.customer_name AS referrer_name,
              ref.phone_number  AS referrer_phone,
              ref.city          AS referrer_city,
              w.weeks
         FROM b
         LEFT JOIN customers ref
                ON ref.id = b.referred_by_id AND ref.owning_admin_id = b.owning_admin_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
                    jsonb_build_object('week', g.n, 'paid', COALESCE(rt.total_collected, 0))
                    ORDER BY g.n) AS weeks
             FROM generate_series(1, b.current_week) AS g(n)
             LEFT JOIN repayment_tracks rt ON rt.loan_id = b.id AND rt.week_number = g.n
         ) w ON true
        ORDER BY b.city NULLS LAST, b.customer_name, b.id`,
      values,
    );
    const rows = (r.rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      // "W1 - 300, W2 - 400, W3 - 0" for the Excel and CSV versions
      weeks_text: ((row.weeks as { week: number; paid: number }[]) ?? [])
        .map((w) => `W${w.week} - ${w.paid}`)
        .join(", "),
    }));
    return { rows, next: null };
  },

  async renderPdf(rows, f) {
    return renderWeekdaySheet({
      weekday: req(f, "weekday"),
      loans: rows as unknown as SheetLoan[],
      generatedAt: new Date(),
    });
  },
};

export const EXPORTS: Record<ExportType, ExportDefinition> = {
  collections,
  overdue,
  weekday_sheet: weekdaySheet,
  due_this_week: dueThisWeek,
  customer_list: customerList,
  loans_register: loansRegister,
  closed_loans: closedLoans,
  new_customers: newCustomers,
  audit_log: auditLog,
  employee_performance: employeePerformance,
  team_summary: teamSummary,
};
