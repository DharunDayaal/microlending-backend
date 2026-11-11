// One definition per export type: who may ask for it, which columns it has, and
// how to read its rows in batches. To add an export, add an entry to EXPORTS.
//
// Batches use keyset paging ("rows after this one"), never OFFSET, so reading
// row 90,000 costs the same as reading row 10. Cursor values are kept as text
// so timestamps keep their full microseconds.
import { getPool } from "../../config/database";
import type {
  ExportCursor,
  ExportDefinition,
  ExportFilters,
  ExportScope,
  ExportType,
} from "../../types/exportTypes";

const TZ = "Asia/Kolkata";
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;

const todayIst = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TZ });

/** " AND l.owning_admin_id = $n AND u.created_by = $m"  (aliases: l loans, u customers) */
function scopeSql(scope: ExportScope, values: unknown[]): string {
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND l.owning_admin_id = $${values.length}`;
  }
  if (scope.createdBy) {
    values.push(scope.createdBy);
    clause += ` AND u.created_by = $${values.length}`;
  }
  return clause;
}

const req = (f: ExportFilters, key: string): string => {
  const v = f[key];
  if (!v) throw new Error(`Missing filter: ${key}`);
  return v;
};

// ---------------------------------------------------------------------------
// Collections: every payment taken in a date range (IST days, inclusive)
// ---------------------------------------------------------------------------
const PAID_RANGE = `
  p.paid_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
  AND p.paid_at < (($2::date) + 1)::timestamp AT TIME ZONE '${TZ}'`;

const collections: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
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
    { header: "Overdue amount (Rs)", key: "overdue_amount", width: 19, kind: "int" },
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

export const EXPORTS: Record<ExportType, ExportDefinition> = {
  collections,
  overdue,
};