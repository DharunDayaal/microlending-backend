// Field and register exports: route sheet, customer list, loans register,
// closed loans, new customers. Registered in exportQueries.ts.
import { getPool } from "../../config/database";
import type { ExportDefinition, ExportFilters } from "../../types/exportTypes";
import {
  NAME,
  TZ,
  custScopeSql,
  istDay,
  loanScopeSql,
  nextCursor,
  param,
  req,
  todayIst,
} from "./exportSql";

const opt = (f: ExportFilters, k: string) => f[k] || undefined;

// ---------------------------------------------------------------------------
// Due this week (collection route sheet): one row per weekly instalment that
// falls due in the date range, for ACTIVE and OVERDUE loans.
// Sorted by day, then city, then name, so it can be walked in order.
// Week N of a loan falls due on issue date + N * 7 days.
// ---------------------------------------------------------------------------
const DUE_DATE = `((l.issued_at AT TIME ZONE '${TZ}')::date + rt.week_number * 7)`;
const DUE_WHERE = `l.status IN ('ACTIVE', 'OVERDUE') AND ${DUE_DATE} BETWEEN $1::date AND $2::date`;

export const dueThisWeek: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN", "USER"],
  title: "Due this week (collection route sheet)",
  columns: [
    { header: "Due date", key: "due_date", width: 13, kind: "date" },
    { header: "Payment day", key: "payment_day", width: 13 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "phone_number", width: 16 },
    { header: "City", key: "city", width: 15 },
    { header: "District", key: "district", width: 15 },
    { header: "Loan", key: "loan_ref", width: 10 },
    { header: "Week", key: "week_number", width: 6, kind: "int" },
    { header: "Amount due (Rs)", key: "amount_due", width: 15, kind: "int" },
    { header: "Paid (Rs)", key: "paid", width: 11, kind: "int" },
    { header: "Balance (Rs)", key: "balance", width: 13, kind: "int" },
    { header: "Week status", key: "week_status", width: 12 },
    { header: "Loan status", key: "loan_status", width: 12 },
    { header: "Added by", key: "added_by", width: 20 },
  ],
  label: (f) => `due_${req(f, "from")}_to_${req(f, "to")}`,

  async count(scope, f) {
    const values: unknown[] = [req(f, "from"), req(f, "to")];
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n
         FROM repayment_tracks rt
         JOIN loans l ON l.id = rt.loan_id
         JOIN customers u ON u.id = l.customer_id
        WHERE ${DUE_WHERE} ${loanScopeSql(scope, values)}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [req(f, "from"), req(f, "to")];
    const scoped = loanScopeSql(scope, values);
    let outer = "";
    if (cursor) {
      const d = param(values, cursor.d), c = param(values, cursor.c);
      const n = param(values, cursor.n), id = param(values, cursor.id);
      outer = `WHERE (x.due_date, x.city_key, x.name_key, x.rid) > (${d}::date, ${c}, ${n}, ${id}::uuid)`;
    }
    const lim = param(values, size);
    const r = await getPool().query(
      `SELECT x.due_text AS due_date, x.payment_day, x.customer_name, x.phone_number,
              x.city, x.district, x.loan_ref, x.week_number, x.amount_due, x.paid,
              GREATEST(x.amount_due - x.paid, 0) AS balance,
              x.week_status, x.loan_status, x.added_by,
              x.city_key, x.name_key, x.rid::text AS rid, x.due_date::text AS cursor_d
         FROM (
           SELECT ${DUE_DATE} AS due_date, ${DUE_DATE}::text AS due_text,
                  COALESCE(u.city, '') AS city_key, u.customer_name AS name_key, rt.id AS rid,
                  u.preferred_payment_day::text AS payment_day,
                  u.customer_name, u.phone_number, u.city, u.district,
                  left(l.id::text, 8) AS loan_ref, rt.week_number,
                  rt.target_amount::int AS amount_due, rt.total_collected::int AS paid,
                  rt.status::text AS week_status, l.status::text AS loan_status,
                  ${NAME("emp")} AS added_by
             FROM repayment_tracks rt
             JOIN loans l ON l.id = rt.loan_id
             JOIN customers u ON u.id = l.customer_id
             LEFT JOIN users emp ON emp.id = u.created_by
            WHERE ${DUE_WHERE} ${scoped}
         ) x
         ${outer}
        ORDER BY x.due_date, x.city_key, x.name_key, x.rid
        LIMIT ${lim}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    return {
      rows,
      next: nextCursor(rows, size, (l) => ({
        d: String(l.cursor_d), c: String(l.city_key), n: String(l.name_key), id: String(l.rid),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Customer list: one row per customer, with live loans and what they still owe
// ---------------------------------------------------------------------------
const customerList: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN", "USER"],
  title: "Customer list",
  columns: [
    { header: "Customer", key: "customer_name", width: 28 },
    { header: "Phone", key: "phone_number", width: 17 },
    { header: "City", key: "city", width: 16 },
    { header: "District", key: "district", width: 16 },
    { header: "Payment day", key: "payment_day", width: 13 },
    { header: "Active loans", key: "active_loans", width: 13, kind: "int" },
    { header: "Outstanding (Rs)", key: "outstanding", width: 17, kind: "int" },
    { header: "Added by", key: "added_by", width: 22 },
  ],
  label: () => `customers_${todayIst()}`,

  async count(scope, f) {
    const values: unknown[] = [];
    let where = custScopeSql(scope, values);
    if (opt(f, "payment_day")) where += ` AND u.preferred_payment_day::text = ${param(values, f.payment_day)}`;
    const r = await getPool().query(`SELECT COUNT(*)::int AS n FROM customers u WHERE TRUE ${where}`, values);
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [];
    let where = custScopeSql(scope, values);
    if (opt(f, "payment_day")) where += ` AND u.preferred_payment_day::text = ${param(values, f.payment_day)}`;
    if (cursor) {
      const n = param(values, cursor.n), id = param(values, cursor.id);
      where += ` AND (u.customer_name, u.id) > (${n}, ${id}::uuid)`;
    }
    const lim = param(values, size);
    const r = await getPool().query(
      `SELECT u.id::text AS id, u.customer_name, u.phone_number, u.city, u.district,
              u.preferred_payment_day::text AS payment_day,
              COALESCE(lv.active_loans, 0) AS active_loans,
              COALESCE(lv.outstanding, 0) AS outstanding,
              ${NAME("emp")} AS added_by
         FROM customers u
         LEFT JOIN users emp ON emp.id = u.created_by
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE l.status IN ('ACTIVE','OVERDUE'))::int AS active_loans,
                  COALESCE(SUM(GREATEST(l.total_payable_amount - COALESCE(c.collected, 0), 0))
                           FILTER (WHERE l.status IN ('ACTIVE','OVERDUE','DEFAULTED')), 0)::int AS outstanding
             FROM loans l
             LEFT JOIN LATERAL (
               SELECT SUM(rt.total_collected) AS collected FROM repayment_tracks rt WHERE rt.loan_id = l.id
             ) c ON true
            WHERE l.customer_id = u.id
         ) lv ON true
        WHERE TRUE ${where}
        ORDER BY u.customer_name, u.id
        LIMIT ${lim}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    return { rows, next: nextCursor(rows, size, (l) => ({ n: String(l.customer_name), id: String(l.id) })) };
  },
};

// ---------------------------------------------------------------------------
// Loans register: every loan, newest first. Interest = total payable - principal.
// ---------------------------------------------------------------------------
function registerWhere(scope: Parameters<typeof loanScopeSql>[0], f: ExportFilters, values: unknown[]) {
  let where = loanScopeSql(scope, values);
  if (opt(f, "status")) where += ` AND l.status::text = ${param(values, f.status)}`;
  if (opt(f, "issued_from")) where += ` AND ${istDay("l.issued_at")} >= ${param(values, f.issued_from)}::date`;
  if (opt(f, "issued_to")) where += ` AND ${istDay("l.issued_at")} <= ${param(values, f.issued_to)}::date`;
  return where;
}

const loansRegister: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
  title: "Loans register",
  columns: [
    { header: "Loan", key: "loan_ref", width: 10 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "phone_number", width: 16 },
    { header: "Status", key: "status", width: 11 },
    { header: "Issued", key: "issued_date", width: 13, kind: "date" },
    { header: "Closed", key: "closed_date", width: 13, kind: "date" },
    { header: "Principal (Rs)", key: "nominal_amount", width: 14, kind: "int" },
    { header: "Fee (Rs)", key: "upfront_fee", width: 10, kind: "int" },
    { header: "Interest (Rs)", key: "interest", width: 13, kind: "int" },
    { header: "Total payable (Rs)", key: "total_payable_amount", width: 18, kind: "int" },
    { header: "Weeks", key: "total_weeks", width: 7, kind: "int" },
    { header: "Weekly (Rs)", key: "weekly_payable_amount", width: 12, kind: "int" },
    { header: "Paid (Rs)", key: "paid", width: 11, kind: "int" },
    { header: "Outstanding (Rs)", key: "outstanding", width: 16, kind: "int" },
    { header: "Added by", key: "added_by", width: 20 },
    { header: "Team admin", key: "team_admin", width: 20 },
  ],
  label: (f) =>
    `loans_register${f.status ? `_${f.status.toLowerCase()}` : ""}${f.issued_from ? `_${f.issued_from}` : ""}${f.issued_to ? `_to_${f.issued_to}` : ""}_${todayIst()}`,

  async count(scope, f) {
    const values: unknown[] = [];
    const where = registerWhere(scope, f, values);
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM loans l JOIN customers u ON u.id = l.customer_id WHERE TRUE ${where}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [];
    let where = registerWhere(scope, f, values);
    if (cursor) {
      const t = param(values, cursor.ts), id = param(values, cursor.id);
      where += ` AND (l.issued_at, l.id) < (${t}::timestamptz, ${id}::uuid)`;
    }
    const lim = param(values, size);
    const r = await getPool().query(
      `SELECT l.id::text AS id, l.issued_at::text AS cursor_ts,
              left(l.id::text, 8) AS loan_ref, u.customer_name, u.phone_number,
              l.status::text AS status,
              ${istDay("l.issued_at")}::text AS issued_date,
              ${istDay("l.closed_at")}::text AS closed_date,
              l.nominal_amount, l.upfront_fee,
              (l.total_payable_amount - l.nominal_amount) AS interest,
              l.total_payable_amount, l.total_weeks, l.weekly_payable_amount,
              pd.paid,
              GREATEST(l.total_payable_amount - pd.paid, 0) AS outstanding,
              ${NAME("emp")} AS added_by, ${NAME("adm")} AS team_admin
         FROM loans l
         JOIN customers u ON u.id = l.customer_id
         LEFT JOIN users emp ON emp.id = u.created_by
         LEFT JOIN users adm ON adm.id = l.owning_admin_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(rt.total_collected), 0)::int AS paid
             FROM repayment_tracks rt WHERE rt.loan_id = l.id
         ) pd ON true
        WHERE TRUE ${where}
        ORDER BY l.issued_at DESC, l.id DESC
        LIMIT ${lim}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    return { rows, next: nextCursor(rows, size, (l) => ({ ts: String(l.cursor_ts), id: String(l.id) })) };
  },
};

// ---------------------------------------------------------------------------
// Closed loans and settlements: loans that reached PAID_OFF, CLOSED or DEFAULTED
// inside the range (by closing day, IST), with what was collected and how long
// they ran.
// ---------------------------------------------------------------------------
function closedWhere(scope: Parameters<typeof loanScopeSql>[0], f: ExportFilters, values: unknown[]) {
  let where = loanScopeSql(scope, values);
  where += opt(f, "status")
    ? ` AND l.status::text = ${param(values, f.status)}`
    : ` AND l.status IN ('PAID_OFF', 'CLOSED', 'DEFAULTED')`;
  where += ` AND ${istDay("l.closed_at")} BETWEEN ${param(values, req(f, "from"))}::date AND ${param(values, req(f, "to"))}::date`;
  return where;
}

const closedLoans: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
  title: "Closed loans and settlements",
  columns: [
    { header: "Loan", key: "loan_ref", width: 10 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "phone_number", width: 16 },
    { header: "Outcome", key: "status", width: 11 },
    { header: "Issued", key: "issued_date", width: 13, kind: "date" },
    { header: "Closed", key: "closed_date", width: 13, kind: "date" },
    { header: "Days ran", key: "days_ran", width: 10, kind: "int" },
    { header: "Principal (Rs)", key: "nominal_amount", width: 14, kind: "int" },
    { header: "Total payable (Rs)", key: "total_payable_amount", width: 18, kind: "int" },
    { header: "Collected (Rs)", key: "collected", width: 14, kind: "int" },
    { header: "Shortfall (Rs)", key: "shortfall", width: 14, kind: "int" },
    { header: "Added by", key: "added_by", width: 20 },
  ],
  label: (f) => `closed_loans_${req(f, "from")}_to_${req(f, "to")}`,

  async count(scope, f) {
    const values: unknown[] = [];
    const where = closedWhere(scope, f, values);
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM loans l JOIN customers u ON u.id = l.customer_id WHERE TRUE ${where}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [];
    let where = closedWhere(scope, f, values);
    if (cursor) {
      const t = param(values, cursor.ts), id = param(values, cursor.id);
      where += ` AND (l.closed_at, l.id) > (${t}::timestamptz, ${id}::uuid)`;
    }
    const lim = param(values, size);
    const r = await getPool().query(
      `SELECT l.id::text AS id, l.closed_at::text AS cursor_ts,
              left(l.id::text, 8) AS loan_ref, u.customer_name, u.phone_number,
              l.status::text AS status,
              ${istDay("l.issued_at")}::text AS issued_date,
              ${istDay("l.closed_at")}::text AS closed_date,
              (${istDay("l.closed_at")} - ${istDay("l.issued_at")})::int AS days_ran,
              l.nominal_amount, l.total_payable_amount,
              pd.collected,
              GREATEST(l.total_payable_amount - pd.collected, 0) AS shortfall,
              ${NAME("emp")} AS added_by
         FROM loans l
         JOIN customers u ON u.id = l.customer_id
         LEFT JOIN users emp ON emp.id = u.created_by
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(rt.total_collected), 0)::int AS collected
             FROM repayment_tracks rt WHERE rt.loan_id = l.id
         ) pd ON true
        WHERE TRUE ${where}
        ORDER BY l.closed_at, l.id
        LIMIT ${lim}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    return { rows, next: nextCursor(rows, size, (l) => ({ ts: String(l.cursor_ts), id: String(l.id) })) };
  },
};

// ---------------------------------------------------------------------------
// New customers and referrals: customers added in the range
// ---------------------------------------------------------------------------
const NEW_RANGE = `${istDay("u.created_at")} BETWEEN $1::date AND $2::date`;

const newCustomers: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
  title: "New customers and referrals",
  columns: [
    { header: "Added on", key: "added_on", width: 13, kind: "date" },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "phone_number", width: 16 },
    { header: "City", key: "city", width: 15 },
    { header: "District", key: "district", width: 15 },
    { header: "Payment day", key: "payment_day", width: 13 },
    { header: "Referred by", key: "referrer_name", width: 24 },
    { header: "Referrer phone", key: "referrer_phone", width: 16 },
    { header: "Added by", key: "added_by", width: 20 },
    { header: "Loans", key: "loans", width: 8, kind: "int" },
  ],
  label: (f) => `new_customers_${req(f, "from")}_to_${req(f, "to")}`,

  async count(scope, f) {
    const values: unknown[] = [req(f, "from"), req(f, "to")];
    const r = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM customers u WHERE ${NEW_RANGE} ${custScopeSql(scope, values)}`,
      values,
    );
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [req(f, "from"), req(f, "to")];
    let where = `${NEW_RANGE} ${custScopeSql(scope, values)}`;
    if (cursor) {
      const t = param(values, cursor.ts), id = param(values, cursor.id);
      where += ` AND (u.created_at, u.id) > (${t}::timestamptz, ${id}::uuid)`;
    }
    const lim = param(values, size);
    const r = await getPool().query(
      `SELECT u.id::text AS id, u.created_at::text AS cursor_ts,
              ${istDay("u.created_at")}::text AS added_on,
              u.customer_name, u.phone_number, u.city, u.district,
              u.preferred_payment_day::text AS payment_day,
              -- a referrer from another team is never shown
              ref.customer_name AS referrer_name, ref.phone_number AS referrer_phone,
              ${NAME("emp")} AS added_by,
              (SELECT COUNT(*)::int FROM loans l WHERE l.customer_id = u.id) AS loans
         FROM customers u
         LEFT JOIN customers ref ON ref.id = u.referred_by_id AND ref.owning_admin_id = u.owning_admin_id
         LEFT JOIN users emp ON emp.id = u.created_by
        WHERE ${where}
        ORDER BY u.created_at, u.id
        LIMIT ${lim}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    return { rows, next: nextCursor(rows, size, (l) => ({ ts: String(l.cursor_ts), id: String(l.id) })) };
  },
};

export { customerList, loansRegister, closedLoans, newCustomers };