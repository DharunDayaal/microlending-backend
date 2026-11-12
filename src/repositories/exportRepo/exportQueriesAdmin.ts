// Admin and owner exports: audit log, employee performance, team summary.
// Registered in exportQueries.ts.
import { getPool } from "../../config/database";
import type { ExportDefinition, ExportFilters, ExportScope } from "../../types/exportTypes";
import { NAME, TODAY, TZ, istDay, nextCursor, param, req } from "./exportSql";

const opt = (f: ExportFilters, k: string) => f[k] || undefined;

// ---------------------------------------------------------------------------
// Audit log: the list as filtered on screen, newest first, with old and new values
// ---------------------------------------------------------------------------
function auditWhere(scope: ExportScope, f: ExportFilters, values: unknown[]): string {
  let where = "TRUE";
  if (scope.owningAdminId) where += ` AND l.owning_admin_id = ${param(values, scope.owningAdminId)}`;
  if (opt(f, "module")) where += ` AND l.module = ${param(values, f.module)}`;
  if (opt(f, "action")) where += ` AND l.action = ${param(values, f.action)}`;
  if (opt(f, "actor_id")) where += ` AND l.actor_id = ${param(values, f.actor_id)}::uuid`;
  if (opt(f, "entity_type")) where += ` AND l.entity_type = ${param(values, f.entity_type)}`;
  if (opt(f, "entity_id")) where += ` AND l.entity_id = ${param(values, f.entity_id)}::uuid`;
  if (opt(f, "from")) {
    where += ` AND l.created_at >= (${param(values, f.from)}::date)::timestamp AT TIME ZONE '${TZ}'`;
  }
  if (opt(f, "to")) {
    where += ` AND l.created_at < ((${param(values, f.to)}::date) + 1)::timestamp AT TIME ZONE '${TZ}'`;
  }
  return where;
}

/** Old/new values are cut at this many characters so one cell never gets huge. */
const AUDIT_VALUE_CHARS = 2000;

const auditLog: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
  title: "Audit log",
  columns: [
    { header: "Time (IST)", key: "at", width: 23 },
    { header: "Module", key: "module", width: 12 },
    { header: "Action", key: "action", width: 26 },
    { header: "By", key: "actor_name", width: 20 },
    { header: "Role", key: "actor_role", width: 12 },
    { header: "Target user", key: "target_name", width: 20 },
    { header: "Record type", key: "entity_type", width: 13 },
    { header: "Record id", key: "entity_id", width: 38 },
    { header: "Old value", key: "old_value", width: 40 },
    { header: "New value", key: "new_value", width: 40 },
    { header: "IP", key: "ip", width: 16 },
  ],
  label: (f) => `audit_log${f.from ? `_${f.from}` : ""}${f.to ? `_to_${f.to}` : ""}`,

  async count(scope, f) {
    const values: unknown[] = [];
    const where = auditWhere(scope, f, values);
    const r = await getPool().query(`SELECT COUNT(*)::int AS n FROM audit_logs l WHERE ${where}`, values);
    return r.rows[0].n as number;
  },

  async fetch(scope, f, cursor, size) {
    const values: unknown[] = [];
    let where = auditWhere(scope, f, values);
    if (cursor) {
      const t = param(values, cursor.ts), id = param(values, cursor.id);
      where += ` AND (l.created_at, l.id) < (${t}::timestamptz, ${id}::uuid)`;
    }
    const lim = param(values, size);
    const r = await getPool().query(
      `SELECT l.id::text AS id, l.created_at::text AS cursor_ts,
              to_char(l.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH12:MI:SS AM') AS at,
              l.module, l.action,
              COALESCE(${NAME("ac")}, CASE WHEN l.actor_id IS NULL THEN 'System' END) AS actor_name,
              l.actor_role, ${NAME("tg")} AS target_name,
              l.entity_type, l.entity_id::text AS entity_id,
              left(l.old_value::text, ${AUDIT_VALUE_CHARS}) AS old_value,
              left(l.new_value::text, ${AUDIT_VALUE_CHARS}) AS new_value,
              l.meta->>'ip' AS ip
         FROM audit_logs l
         LEFT JOIN users ac ON ac.id = l.actor_id
         LEFT JOIN users tg ON tg.id = l.target_id
        WHERE ${where}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${lim}`,
      values,
    );
    const rows = r.rows as Record<string, unknown>[];
    return { rows, next: nextCursor(rows, size, (l) => ({ ts: String(l.cursor_ts), id: String(l.id) })) };
  },
};

// ---------------------------------------------------------------------------
// Shared by the two summaries: loans with what was collected and what was
// expected by now (same on-schedule rule as the leaderboard and admin screens).
// ---------------------------------------------------------------------------
const LIVE = `'ACTIVE','OVERDUE','DEFAULTED'`;

const LOAN_FACTS = (ownerExpr: string) => `
  SELECT ${ownerExpr} AS owner_id, l.id, l.status::text AS status, l.closed_at,
         l.total_payable_amount, l.disbursed_amount,
         ${istDay("l.issued_at")} AS issued_date,
         COALESCE(t.collected, 0) AS collected,
         LEAST(l.total_payable_amount,
               LEAST(l.total_weeks, GREATEST(0, (${TODAY} - ${istDay("l.issued_at")}) / 7))
                 * l.weekly_payable_amount) AS expected
    FROM loans l
    JOIN customers c ON c.id = l.customer_id
    LEFT JOIN LATERAL (
      SELECT SUM(rt.total_collected) AS collected FROM repayment_tracks rt WHERE rt.loan_id = l.id
    ) t ON true`;

const pct = (num: string, den: string) => `ROUND(100.0 * ${num} / NULLIF(${den}, 0), 1)::float8`;

// ---------------------------------------------------------------------------
// Employee performance: one row per employee for a date range
//  - Collected: payments taken in the range on their customers' loans
//  - Target: weekly instalments falling due in the range
//  - Collection rate: collected / target (can pass 100 when old dues are paid)
//  - On-schedule rate: the leaderboard's rate (collected vs expected by today, all loans)
// ---------------------------------------------------------------------------
async function employeeRows(scope: ExportScope, f: ExportFilters): Promise<Record<string, unknown>[]> {
  const values: unknown[] = [req(f, "from"), req(f, "to")];
  let empFilter = "";
  if (scope.owningAdminId) empFilter = ` AND e.admin_id = ${param(values, scope.owningAdminId)}`;
  const r = await getPool().query(
    `WITH emp AS (
       SELECT e.id, ${NAME("e")} AS name, e.admin_id
         FROM users e WHERE e.role = 'USER' ${empFilter}
     ),
     ln AS (${LOAN_FACTS("c.created_by")} WHERE c.created_by IN (SELECT id FROM emp)),
     agg AS (
       SELECT owner_id,
              COUNT(*) FILTER (WHERE status IN ('ACTIVE','OVERDUE'))::int AS active_loans,
              COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_loans,
              COUNT(*) FILTER (WHERE issued_date BETWEEN $1::date AND $2::date)::int AS new_loans,
              COALESCE(SUM(total_payable_amount - collected)
                       FILTER (WHERE status IN (${LIVE}) AND total_payable_amount > collected), 0)::int AS outstanding,
              COALESCE(SUM(LEAST(collected, expected)) FILTER (WHERE status IN (${LIVE})), 0) AS on_schedule,
              COALESCE(SUM(expected) FILTER (WHERE status IN (${LIVE})), 0) AS expected
         FROM ln GROUP BY owner_id
     ),
     od AS (
       SELECT ln.owner_id,
              COALESCE(SUM(GREATEST(rt.target_amount - rt.total_collected, 0)), 0)::int AS overdue_amount
         FROM ln JOIN repayment_tracks rt ON rt.loan_id = ln.id
        WHERE ln.status IN ('ACTIVE','OVERDUE') AND rt.status <> 'PAID'
          AND (ln.issued_date + rt.week_number * 7) < ${TODAY}
        GROUP BY ln.owner_id
     ),
     tg AS (
       SELECT ln.owner_id, SUM(rt.target_amount)::int AS target
         FROM ln JOIN repayment_tracks rt ON rt.loan_id = ln.id
        WHERE (ln.issued_date + rt.week_number * 7) BETWEEN $1::date AND $2::date
          AND (ln.closed_at IS NULL OR (ln.issued_date + rt.week_number * 7) <= ${istDay("ln.closed_at")})
        GROUP BY ln.owner_id
     ),
     co AS (
       SELECT c.created_by AS owner_id, SUM(p.amount_paid)::int AS collected
         FROM payments p
         JOIN loans l ON l.id = p.loan_id
         JOIN customers c ON c.id = l.customer_id
        WHERE c.created_by IN (SELECT id FROM emp)
          AND ${istDay("p.paid_at")} BETWEEN $1::date AND $2::date
        GROUP BY c.created_by
     ),
     nc AS (
       SELECT c.created_by AS owner_id, COUNT(*)::int AS new_customers
         FROM customers c
        WHERE c.created_by IN (SELECT id FROM emp)
          AND ${istDay("c.created_at")} BETWEEN $1::date AND $2::date
        GROUP BY c.created_by
     )
     SELECT emp.name AS employee, ${NAME("a")} AS team_admin,
            COALESCE(co.collected, 0) AS collected,
            COALESCE(tg.target, 0) AS target,
            ${pct("COALESCE(co.collected, 0)", "COALESCE(tg.target, 0)")} AS collection_rate,
            ${pct("agg.on_schedule", "agg.expected")} AS on_schedule_rate,
            COALESCE(agg.overdue_loans, 0) AS overdue_loans,
            COALESCE(od.overdue_amount, 0) AS overdue_amount,
            COALESCE(nc.new_customers, 0) AS new_customers,
            COALESCE(agg.new_loans, 0) AS new_loans,
            COALESCE(agg.active_loans, 0) AS active_loans,
            COALESCE(agg.outstanding, 0) AS outstanding
       FROM emp
       LEFT JOIN users a ON a.id = emp.admin_id
       LEFT JOIN agg ON agg.owner_id = emp.id
       LEFT JOIN od ON od.owner_id = emp.id
       LEFT JOIN tg ON tg.owner_id = emp.id
       LEFT JOIN co ON co.owner_id = emp.id
       LEFT JOIN nc ON nc.owner_id = emp.id
      ORDER BY COALESCE(co.collected, 0) DESC, emp.name, emp.id`,
    values,
  );
  return r.rows as Record<string, unknown>[];
}

const employeePerformance: ExportDefinition = {
  roles: ["SUPER_ADMIN", "ADMIN"],
  title: "Employee performance",
  columns: [
    { header: "Employee", key: "employee", width: 24 },
    { header: "Team admin", key: "team_admin", width: 22 },
    { header: "Collected (Rs)", key: "collected", width: 15, kind: "int" },
    { header: "Target (Rs)", key: "target", width: 13, kind: "int" },
    { header: "Collection rate", key: "collection_rate", width: 15, kind: "pct" },
    { header: "On-schedule rate", key: "on_schedule_rate", width: 16, kind: "pct" },
    { header: "Overdue loans", key: "overdue_loans", width: 14, kind: "int" },
    { header: "Overdue amount (Rs)", key: "overdue_amount", width: 19, kind: "int" },
    { header: "New customers", key: "new_customers", width: 14, kind: "int" },
    { header: "New loans", key: "new_loans", width: 11, kind: "int" },
    { header: "Active loans", key: "active_loans", width: 13, kind: "int" },
    { header: "Outstanding (Rs)", key: "outstanding", width: 17, kind: "int" },
  ],
  label: (f) => `employee_performance_${req(f, "from")}_to_${req(f, "to")}`,
  async count(scope, f) {
    return (await employeeRows(scope, f)).length;
  },
  // one row per employee: always small, so it is read in a single batch
  async fetch(scope, f) {
    return { rows: await employeeRows(scope, f), next: null };
  },
};

// ---------------------------------------------------------------------------
// Team summary (super admin): one row per admin
// ---------------------------------------------------------------------------
async function teamRows(f: ExportFilters): Promise<Record<string, unknown>[]> {
  const values: unknown[] = [req(f, "from"), req(f, "to")];
  const r = await getPool().query(
    `WITH adm AS (
       SELECT a.id, ${NAME("a")} AS name
         FROM users a
        WHERE (a.role = 'ADMIN' AND (
                 a.is_active
                 OR EXISTS (SELECT 1 FROM loans l WHERE l.owning_admin_id = a.id)
                 OR EXISTS (SELECT 1 FROM customers c WHERE c.owning_admin_id = a.id)))
           OR (a.role = 'SUPER_ADMIN' AND (
                 EXISTS (SELECT 1 FROM loans l WHERE l.owning_admin_id = a.id)
                 OR EXISTS (SELECT 1 FROM customers c WHERE c.owning_admin_id = a.id)))
     ),
     ln AS (${LOAN_FACTS("l.owning_admin_id")}),
     agg AS (
       SELECT owner_id,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_loans,
              COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_loans,
              COUNT(*) FILTER (WHERE status = 'DEFAULTED')::int AS defaulted_loans,
              COALESCE(SUM(disbursed_amount) FILTER (WHERE issued_date BETWEEN $1::date AND $2::date), 0)::int AS disbursed,
              COALESCE(SUM(total_payable_amount - collected)
                       FILTER (WHERE status IN (${LIVE}) AND total_payable_amount > collected), 0)::int AS outstanding,
              COALESCE(SUM(LEAST(collected, expected)) FILTER (WHERE status IN (${LIVE})), 0) AS on_schedule,
              COALESCE(SUM(expected) FILTER (WHERE status IN (${LIVE})), 0) AS expected
         FROM ln GROUP BY owner_id
     ),
     od AS (
       SELECT ln.owner_id,
              COALESCE(SUM(GREATEST(rt.target_amount - rt.total_collected, 0)), 0)::int AS overdue_amount
         FROM ln JOIN repayment_tracks rt ON rt.loan_id = ln.id
        WHERE ln.status IN ('ACTIVE','OVERDUE') AND rt.status <> 'PAID'
          AND (ln.issued_date + rt.week_number * 7) < ${TODAY}
        GROUP BY ln.owner_id
     ),
     co AS (
       SELECT l.owning_admin_id AS owner_id, SUM(p.amount_paid)::int AS collected
         FROM payments p JOIN loans l ON l.id = p.loan_id
        WHERE ${istDay("p.paid_at")} BETWEEN $1::date AND $2::date
        GROUP BY l.owning_admin_id
     ),
     cu AS (SELECT owning_admin_id AS owner_id, COUNT(*)::int AS customers FROM customers GROUP BY 1),
     em AS (SELECT admin_id AS owner_id, COUNT(*)::int AS employees FROM users WHERE role = 'USER' GROUP BY 1)
     SELECT adm.name AS admin,
            COALESCE(em.employees, 0) AS employees,
            COALESCE(cu.customers, 0) AS customers,
            COALESCE(agg.active_loans, 0) AS active_loans,
            COALESCE(agg.overdue_loans, 0) AS overdue_loans,
            COALESCE(agg.defaulted_loans, 0) AS defaulted_loans,
            COALESCE(agg.disbursed, 0) AS disbursed,
            COALESCE(co.collected, 0) AS collected,
            COALESCE(agg.outstanding, 0) AS outstanding,
            COALESCE(od.overdue_amount, 0) AS overdue_amount,
            ${pct("agg.on_schedule", "agg.expected")} AS on_schedule_rate
       FROM adm
       LEFT JOIN agg ON agg.owner_id = adm.id
       LEFT JOIN od ON od.owner_id = adm.id
       LEFT JOIN co ON co.owner_id = adm.id
       LEFT JOIN cu ON cu.owner_id = adm.id
       LEFT JOIN em ON em.owner_id = adm.id
      ORDER BY COALESCE(co.collected, 0) DESC, COALESCE(agg.outstanding, 0) DESC, adm.name, adm.id`,
    values,
  );
  return r.rows as Record<string, unknown>[];
}

const teamSummary: ExportDefinition = {
  roles: ["SUPER_ADMIN"],
  title: "Team summary",
  columns: [
    { header: "Admin", key: "admin", width: 24 },
    { header: "Employees", key: "employees", width: 11, kind: "int" },
    { header: "Customers", key: "customers", width: 11, kind: "int" },
    { header: "Active loans", key: "active_loans", width: 13, kind: "int" },
    { header: "Overdue loans", key: "overdue_loans", width: 14, kind: "int" },
    { header: "Defaulted loans", key: "defaulted_loans", width: 15, kind: "int" },
    { header: "Disbursed in range (Rs)", key: "disbursed", width: 22, kind: "int" },
    { header: "Collected in range (Rs)", key: "collected", width: 22, kind: "int" },
    { header: "Outstanding (Rs)", key: "outstanding", width: 17, kind: "int" },
    { header: "Overdue amount (Rs)", key: "overdue_amount", width: 19, kind: "int" },
    { header: "On-schedule rate", key: "on_schedule_rate", width: 16, kind: "pct" },
  ],
  label: (f) => `team_summary_${req(f, "from")}_to_${req(f, "to")}`,
  async count(_scope, f) {
    return (await teamRows(f)).length;
  },
  async fetch(_scope, f) {
    return { rows: await teamRows(f), next: null };
  },
};

export { auditLog, employeePerformance, teamSummary };