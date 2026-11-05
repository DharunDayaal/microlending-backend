import { getPool } from "../../config/database";

/**
 * Analytics repository.
 *
 * Every "scoped" function takes a Scope:
 *   owningAdminId -> loans.owning_admin_id / customers.owning_admin_id
 *   createdBy     -> customers.created_by (employee's own customers)
 * All dates are computed in Asia/Kolkata.
 */
export type Scope = { owningAdminId?: string; createdBy?: string };
export type GroupBy = "day" | "week" | "month";

const TZ = "Asia/Kolkata";
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;
const LIVE = `'ACTIVE','OVERDUE','DEFAULTED'`;
const GROUPS: GroupBy[] = ["day", "week", "month"];
const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

function safeGroup(g: GroupBy): GroupBy {
  if (!GROUPS.includes(g)) throw new Error("Invalid group_by");
  return g;
}

/** date_trunc on a date/timestamp expression, returned as a date. */
const trunc = (g: GroupBy, expr: string) =>
  `date_trunc('${safeGroup(g)}', (${expr})::timestamp)::date`;

/** " AND l.owning_admin_id = $n AND u.created_by = $m" (aliases: l loans, u customers) */
function loanScope(scope: Scope, values: unknown[]): string {
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

/** Same, for queries that start from customers (alias u). */
function customerScope(scope: Scope, values: unknown[]): string {
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND u.owning_admin_id = $${values.length}`;
  }
  if (scope.createdBy) {
    values.push(scope.createdBy);
    clause += ` AND u.created_by = $${values.length}`;
  }
  return clause;
}

/**
 * CTEs shared by most queries:
 *   sl : scoped loans + customer fields
 *   lc : sl + issued_date, maturity_date, collected, outstanding,
 *        dpd (days past due, >=1 for OVERDUE/DEFAULTED), expected_to_date
 * Use as: `WITH ${base(scope, values)} SELECT ...`
 */
function base(scope: Scope, values: unknown[]): string {
  const clause = loanScope(scope, values);
  return `
    sl AS (
      SELECT l.*,
             u.customer_name, u.phone_number, u.preferred_payment_day,
             u.district, u.city, u.referred_by_id,
             u.created_by AS customer_created_by
      FROM loans l
      JOIN customers u ON u.id = l.customer_id
      WHERE 1 = 1 ${clause}
    ),
    lc AS (
      SELECT s.*,
             i.issued_date,
             i.issued_date + s.total_weeks * 7 AS maturity_date,
             COALESCE(c.collected, 0) AS collected,
             s.total_payable_amount - COALESCE(c.collected, 0) AS outstanding,
             CASE WHEN s.status IN ('OVERDUE','DEFAULTED')
                  THEN GREATEST(1, d.raw) ELSE d.raw END AS dpd,
             LEAST(
               s.total_payable_amount,
               LEAST(s.total_weeks, GREATEST(0, (${TODAY} - i.issued_date) / 7))
                 * s.weekly_payable_amount
             ) AS expected_to_date
      FROM sl s
      CROSS JOIN LATERAL (
        SELECT (s.issued_at AT TIME ZONE '${TZ}')::date AS issued_date
      ) i
      CROSS JOIN LATERAL (
        SELECT GREATEST(0, ${TODAY} - (i.issued_date + s.total_weeks * 7))::int AS raw
      ) d
      LEFT JOIN (
        SELECT rt.loan_id, SUM(rt.total_collected) AS collected
        FROM repayment_tracks rt
        WHERE rt.loan_id IN (SELECT id FROM sl)
        GROUP BY rt.loan_id
      ) c ON c.loan_id = s.id
    )`;
}

/** Scheduled instalments (week 1..total_weeks) falling in [from, to]. */
function dueCte(fromIdx: number, toIdx: number): string {
  return `
    due AS (
      SELECT x.due_date, x.amt, x.owning_admin_id, x.wd, x.customer_id
      FROM (
        SELECT s.issued_date + k * 7 AS due_date,
               s.weekly_payable_amount AS amt,
               s.owning_admin_id,
               s.preferred_payment_day::text AS wd,
               s.customer_id,
               s.closed_at
        FROM lc s
        CROSS JOIN LATERAL generate_series(1, s.total_weeks) AS k
      ) x
      WHERE x.due_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
        AND (x.closed_at IS NULL
             OR x.due_date <= (x.closed_at AT TIME ZONE '${TZ}')::date)
    )`;
}

async function rows<T = Record<string, unknown>>(
  sql: string,
  values: unknown[],
): Promise<T[]> {
  const result = await getPool().query(sql, values);
  return result.rows as T[];
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewRow {
  active_loans: number;
  overdue_loans: number;
  defaulted_loans: number;
  paid_off_loans: number;
  closed_loans: number;
  active_borrowers: number;
  total_nominal: number;
  total_disbursed: number;
  total_collected: number;
  total_outstanding: number;
  par_amount: number;
  avg_ticket: number;
  on_schedule_collected: number;
  expected_to_date: number;
}

export async function getOverviewRepo(scope: Scope): Promise<{
  totals: OverviewRow;
  collected_today: number;
  collected_week: number;
  collected_month: number;
  total_customers: number;
}> {
  const v1: unknown[] = [];
  const totalsSql = `
    WITH ${base(scope, v1)}
    SELECT
      COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_loans,
      COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_loans,
      COUNT(*) FILTER (WHERE status = 'DEFAULTED')::int AS defaulted_loans,
      COUNT(*) FILTER (WHERE status = 'PAID_OFF')::int AS paid_off_loans,
      COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_loans,
      COUNT(DISTINCT customer_id) FILTER (WHERE status IN ('ACTIVE','OVERDUE'))::int AS active_borrowers,
      COALESCE(SUM(nominal_amount), 0)::float8 AS total_nominal,
      COALESCE(SUM(disbursed_amount), 0)::float8 AS total_disbursed,
      COALESCE(SUM(collected), 0)::float8 AS total_collected,
      COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0), 0)::float8 AS total_outstanding,
      COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0 AND dpd > 0), 0)::float8 AS par_amount,
      COALESCE(AVG(nominal_amount), 0)::float8 AS avg_ticket,
      COALESCE(SUM(LEAST(collected, expected_to_date)), 0)::float8 AS on_schedule_collected,
      COALESCE(SUM(expected_to_date), 0)::float8 AS expected_to_date
    FROM lc`;

  const v2: unknown[] = [];
  const paySql = `
    WITH ${base(scope, v2)}
    SELECT
      COALESCE(SUM(x.amt) FILTER (WHERE x.pd = ${TODAY}), 0)::float8 AS collected_today,
      COALESCE(SUM(x.amt) FILTER (WHERE x.pd >= date_trunc('week', ${TODAY}::timestamp)::date), 0)::float8 AS collected_week,
      COALESCE(SUM(x.amt) FILTER (WHERE x.pd >= date_trunc('month', ${TODAY}::timestamp)::date), 0)::float8 AS collected_month
    FROM (
      SELECT p.amount_paid AS amt, (p.paid_at AT TIME ZONE '${TZ}')::date AS pd
      FROM payments p
      JOIN sl ON sl.id = p.loan_id
    ) x`;

  const v3: unknown[] = [];
  const custClause = customerScope(scope, v3);
  const custSql = `SELECT COUNT(*)::int AS total_customers FROM customers u WHERE 1 = 1 ${custClause}`;

  const [t, p, c] = await Promise.all([
    rows<OverviewRow>(totalsSql, v1),
    rows<{
      collected_today: number;
      collected_week: number;
      collected_month: number;
    }>(paySql, v2),
    rows<{ total_customers: number }>(custSql, v3),
  ]);

  return {
    totals: t[0],
    collected_today: p[0].collected_today,
    collected_week: p[0].collected_week,
    collected_month: p[0].collected_month,
    total_customers: c[0].total_customers,
  };
}

// ---------------------------------------------------------------------------
// Collections trend (target vs collected per period)
// ---------------------------------------------------------------------------

export async function getCollectionsTrendRepo(
  scope: Scope,
  from: string,
  to: string,
  groupBy: GroupBy,
  splitByAdmin = false,
): Promise<
  {
    period: string;
    admin_id: string | null;
    target: number;
    collected: number;
  }[]
> {
  const values: unknown[] = [];
  const b = base(scope, values);
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;
  const adminExpr = splitByAdmin ? "owning_admin_id" : "NULL::uuid";

  return rows(
    `
    WITH ${b},
    ${dueCte(f, t)},
    tgt AS (
      SELECT ${trunc(groupBy, "due_date")} AS bucket,
             ${adminExpr} AS admin_id,
             SUM(amt) AS target
      FROM due GROUP BY 1, 2
    ),
    col AS (
      SELECT ${trunc(groupBy, `p.paid_at AT TIME ZONE '${TZ}'`)} AS bucket,
             ${splitByAdmin ? "sl.owning_admin_id" : "NULL::uuid"} AS admin_id,
             SUM(p.amount_paid) AS collected
      FROM payments p
      JOIN sl ON sl.id = p.loan_id
      WHERE (p.paid_at AT TIME ZONE '${TZ}')::date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1, 2
    )
    SELECT COALESCE(t.bucket, c.bucket)::text AS period,
           COALESCE(t.admin_id, c.admin_id) AS admin_id,
           COALESCE(t.target, 0)::float8 AS target,
           COALESCE(c.collected, 0)::float8 AS collected
    FROM tgt t
    FULL OUTER JOIN col c
      ON c.bucket = t.bucket AND c.admin_id IS NOT DISTINCT FROM t.admin_id
    ORDER BY 1, 2
    `,
    values,
  );
}

// ---------------------------------------------------------------------------
// Collections by weekday
// ---------------------------------------------------------------------------

export async function getCollectionsByWeekdayRepo(
  scope: Scope,
  from: string,
  to: string,
): Promise<
  {
    weekday: string;
    customers: number;
    active_loans: number;
    target: number;
    collected: number;
  }[]
> {
  const values: unknown[] = [];
  const b = base(scope, values);
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;

  const order = WEEKDAYS.map((d, i) => `WHEN '${d}' THEN ${i}`).join(" ");

  return rows(
    `
    WITH ${b},
    ${dueCte(f, t)},
    cust AS (
      SELECT COALESCE(preferred_payment_day::text, 'UNSET') AS wd,
             COUNT(DISTINCT customer_id) FILTER (WHERE status IN ('ACTIVE','OVERDUE'))::int AS customers,
             COUNT(*) FILTER (WHERE status IN ('ACTIVE','OVERDUE'))::int AS active_loans
      FROM lc GROUP BY 1
    ),
    tgt AS (
      SELECT COALESCE(wd, 'UNSET') AS wd, SUM(amt) AS target FROM due GROUP BY 1
    ),
    col AS (
      SELECT COALESCE(sl.preferred_payment_day::text, 'UNSET') AS wd,
             SUM(p.amount_paid) AS collected
      FROM payments p
      JOIN sl ON sl.id = p.loan_id
      WHERE (p.paid_at AT TIME ZONE '${TZ}')::date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1
    )
    SELECT cust.wd AS weekday,
           cust.customers,
           cust.active_loans,
           COALESCE(tgt.target, 0)::float8 AS target,
           COALESCE(col.collected, 0)::float8 AS collected
    FROM cust
    LEFT JOIN tgt ON tgt.wd = cust.wd
    LEFT JOIN col ON col.wd = cust.wd
    ORDER BY CASE cust.wd ${order} ELSE 7 END
    `,
    values,
  );
}

// ---------------------------------------------------------------------------
// Portfolio aging + status
// ---------------------------------------------------------------------------

export async function getAgingRepo(
  scope: Scope,
  byAdmin = false,
): Promise<
  {
    bucket: string;
    admin_id: string | null;
    loans: number;
    outstanding: number;
  }[]
> {
  const values: unknown[] = [];
  const b = base(scope, values);
  return rows(
    `
    WITH ${b}
    SELECT bucket,
           ${byAdmin ? "owning_admin_id" : "NULL::uuid"} AS admin_id,
           COUNT(*)::int AS loans,
           COALESCE(SUM(outstanding), 0)::float8 AS outstanding
    FROM (
      SELECT owning_admin_id, outstanding,
             CASE WHEN dpd = 0 THEN 'CURRENT'
                  WHEN dpd <= 7 THEN '1-7'
                  WHEN dpd <= 14 THEN '8-14'
                  WHEN dpd <= 30 THEN '15-30'
                  ELSE '30+' END AS bucket
      FROM lc
      WHERE status IN (${LIVE}) AND outstanding > 0
    ) x
    GROUP BY 1, 2
    `,
    values,
  );
}

export async function getStatusBreakdownRepo(scope: Scope): Promise<
  {
    status: string;
    loans: number;
    nominal: number;
    collected: number;
    outstanding: number;
  }[]
> {
  const values: unknown[] = [];
  const b = base(scope, values);
  return rows(
    `
    WITH ${b}
    SELECT status::text AS status,
           COUNT(*)::int AS loans,
           COALESCE(SUM(nominal_amount), 0)::float8 AS nominal,
           COALESCE(SUM(collected), 0)::float8 AS collected,
           COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0), 0)::float8 AS outstanding
    FROM lc
    GROUP BY status
    `,
    values,
  );
}

// ---------------------------------------------------------------------------
// Disbursements + earnings trends
// ---------------------------------------------------------------------------

export async function getDisbursementTrendRepo(
  scope: Scope,
  from: string,
  to: string,
  groupBy: GroupBy,
): Promise<
  {
    period: string;
    loans: number;
    nominal: number;
    disbursed: number;
    fees: number;
  }[]
> {
  const values: unknown[] = [];
  const b = base(scope, values);
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;
  return rows(
    `
    WITH ${b}
    SELECT ${trunc(groupBy, "issued_date")}::text AS period,
           COUNT(*)::int AS loans,
           COALESCE(SUM(nominal_amount), 0)::float8 AS nominal,
           COALESCE(SUM(disbursed_amount), 0)::float8 AS disbursed,
           COALESCE(SUM(upfront_fee), 0)::float8 AS fees
    FROM lc
    WHERE issued_date BETWEEN $${f}::date AND $${t}::date
    GROUP BY 1
    ORDER BY 1
    `,
    values,
  );
}

export async function getEarningsTrendRepo(
  scope: Scope,
  from: string,
  to: string,
  groupBy: GroupBy,
  splitByAdmin = false,
): Promise<
  {
    period: string;
    admin_id: string | null;
    fees: number;
    interest_earned: number;
    interest_expected: number;
  }[]
> {
  const values: unknown[] = [];
  const b = base(scope, values);
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;
  const adm = splitByAdmin ? "owning_admin_id" : "NULL::uuid";

  return rows(
    `
    WITH ${b},
    fees AS (
      SELECT ${trunc(groupBy, "issued_date")} AS bucket,
             ${adm} AS admin_id,
             SUM(upfront_fee) AS fees,
             SUM(total_payable_amount - nominal_amount) AS interest_expected
      FROM lc
      WHERE issued_date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1, 2
    ),
    pay AS (
      SELECT p.paid_at, p.amount_paid, sl.nominal_amount, sl.owning_admin_id,
             SUM(p.amount_paid) OVER (
               PARTITION BY p.loan_id ORDER BY p.paid_at, p.id
             ) AS cum
      FROM payments p
      JOIN sl ON sl.id = p.loan_id
    ),
    intr AS (
      SELECT ${trunc(groupBy, `paid_at AT TIME ZONE '${TZ}'`)} AS bucket,
             ${adm} AS admin_id,
             SUM(GREATEST(0, cum - nominal_amount)
               - GREATEST(0, cum - amount_paid - nominal_amount)) AS interest
      FROM pay
      WHERE (paid_at AT TIME ZONE '${TZ}')::date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1, 2
    )
    SELECT COALESCE(fe.bucket, i.bucket)::text AS period,
           COALESCE(fe.admin_id, i.admin_id) AS admin_id,
           COALESCE(fe.fees, 0)::float8 AS fees,
           COALESCE(i.interest, 0)::float8 AS interest_earned,
           COALESCE(fe.interest_expected, 0)::float8 AS interest_expected
    FROM fees fe
    FULL OUTER JOIN intr i
      ON i.bucket = fe.bucket AND i.admin_id IS NOT DISTINCT FROM fe.admin_id
    ORDER BY 1, 2
    `,
    values,
  );
}

// ---------------------------------------------------------------------------
// Forecast + maturing
// ---------------------------------------------------------------------------

export async function getForecastRepo(
  scope: Scope,
  weeks: number,
): Promise<{
  arrears_due_now: number;
  weeks: { week_index: number; expected: number }[];
}> {
  const v1: unknown[] = [];
  const b1 = base(scope, v1);
  v1.push(weeks);
  const nIdx = v1.length;

  const weeksSql = `
    WITH ${b1},
    live AS (
      SELECT * FROM lc WHERE status IN ('ACTIVE','OVERDUE') AND outstanding > 0
    ),
    fut AS (
      SELECT x.id, x.due_date, x.amt,
             GREATEST(0, x.outstanding - x.arrears) AS fut_out,
             SUM(x.amt) OVER (PARTITION BY x.id ORDER BY x.due_date) - x.amt AS prior
      FROM (
        SELECT lv.id, lv.weekly_payable_amount AS amt, lv.outstanding,
               GREATEST(0, lv.expected_to_date - lv.collected) AS arrears,
               lv.issued_date + k * 7 AS due_date
        FROM live lv
        CROSS JOIN LATERAL generate_series(1, lv.total_weeks) AS k
      ) x
      WHERE x.due_date > ${TODAY} AND x.due_date <= ${TODAY} + ($${nIdx}::int * 7)
    )
    SELECT ((due_date - ${TODAY} - 1) / 7)::int AS week_index,
           COALESCE(SUM(GREATEST(0, LEAST(amt, fut_out - prior))), 0)::float8 AS expected
    FROM fut
    GROUP BY 1
    ORDER BY 1`;

  const v2: unknown[] = [];
  const b2 = base(scope, v2);
  const arrearsSql = `
    WITH ${b2}
    SELECT COALESCE(SUM(GREATEST(0, LEAST(outstanding, expected_to_date - collected))), 0)::float8 AS arrears
    FROM lc
    WHERE status IN ('ACTIVE','OVERDUE') AND outstanding > 0`;

  const [w, a] = await Promise.all([
    rows<{ week_index: number; expected: number }>(weeksSql, v1),
    rows<{ arrears: number }>(arrearsSql, v2),
  ]);
  return { arrears_due_now: a[0].arrears, weeks: w };
}

export async function getMaturingLoansRepo(
  scope: Scope,
  days: number,
  page: number,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const values: unknown[] = [];
  const b = base(scope, values);
  values.push(days, limit, (page - 1) * limit);
  const dIdx = values.length - 2;
  const lIdx = values.length - 1;
  const oIdx = values.length;

  const result = await rows<Record<string, unknown> & { total: number }>(
    `
    WITH ${b}
    SELECT id AS loan_id, customer_id, customer_name, phone_number,
           status::text AS status,
           maturity_date::text AS maturity_date,
           (maturity_date - ${TODAY})::int AS days_left,
           outstanding::float8 AS outstanding,
           weekly_payable_amount::float8 AS weekly_payable_amount,
           collected::float8 AS collected,
           COUNT(*) OVER()::int AS total
    FROM lc
    WHERE status IN ('ACTIVE','OVERDUE')
      AND outstanding > 0
      AND maturity_date BETWEEN ${TODAY} AND ${TODAY} + $${dIdx}::int
    ORDER BY maturity_date, outstanding DESC
    LIMIT $${lIdx} OFFSET $${oIdx}
    `,
    values,
  );
  const total = result[0]?.total ?? 0;
  return { rows: result.map(({ total: _t, ...r }) => r), total };
}

// ---------------------------------------------------------------------------
// Payment behaviour
// ---------------------------------------------------------------------------

export async function getPaymentBehaviourRepo(
  scope: Scope,
  from: string,
  to: string,
): Promise<{
  timing: {
    payments: number;
    collected: number;
    on_time: number;
    late: number;
    avg_days_late: number;
    max_days_late: number;
  };
  outcomes: {
    weeks: number;
    paid: number;
    partial: number;
    unpaid: number;
    overpaid: number;
  };
}> {
  const v1: unknown[] = [];
  const b1 = base(scope, v1);
  v1.push(from, to);
  const timingSql = `
    WITH ${b1}
    SELECT COUNT(*)::int AS payments,
           COALESCE(SUM(x.amount), 0)::float8 AS collected,
           COUNT(*) FILTER (WHERE x.days_late <= 0)::int AS on_time,
           COUNT(*) FILTER (WHERE x.days_late > 0)::int AS late,
           COALESCE(AVG(x.days_late) FILTER (WHERE x.days_late > 0), 0)::float8 AS avg_days_late,
           COALESCE(MAX(x.days_late), 0)::int AS max_days_late
    FROM (
      SELECT p.amount_paid AS amount,
             ((p.paid_at AT TIME ZONE '${TZ}')::date - (lc.issued_date + rt.week_number * 7)) AS days_late
      FROM payments p
      JOIN repayment_tracks rt ON rt.id = p.track_id
      JOIN lc ON lc.id = p.loan_id
      WHERE (p.paid_at AT TIME ZONE '${TZ}')::date BETWEEN $${v1.length - 1}::date AND $${v1.length}::date
    ) x`;

  const v2: unknown[] = [];
  const b2 = base(scope, v2);
  v2.push(from, to);
  const outcomesSql = `
    WITH ${b2}
    SELECT COUNT(*)::int AS weeks,
           COUNT(*) FILTER (WHERE rt.status = 'PAID')::int AS paid,
           COUNT(*) FILTER (WHERE rt.status = 'PARTIAL')::int AS partial,
           COUNT(*) FILTER (WHERE rt.status = 'UNPAID')::int AS unpaid,
           COUNT(*) FILTER (WHERE rt.total_collected > rt.target_amount)::int AS overpaid
    FROM repayment_tracks rt
    JOIN lc ON lc.id = rt.loan_id
    WHERE (lc.issued_date + rt.week_number * 7)
          BETWEEN $${v2.length - 1}::date AND LEAST($${v2.length}::date, ${TODAY})`;

  const [t, o] = await Promise.all([
    rows<any>(timingSql, v1),
    rows<any>(outcomesSql, v2),
  ]);
  return { timing: t[0], outcomes: o[0] };
}

// ---------------------------------------------------------------------------
// Customer risk, repeat borrowers, referrals, geography
// ---------------------------------------------------------------------------

export async function getCustomerRiskRepo(
  scope: Scope,
  page: number,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const values: unknown[] = [];
  const b = base(scope, values);
  values.push(limit, (page - 1) * limit);
  const lIdx = values.length - 1;
  const oIdx = values.length;

  const result = await rows<Record<string, unknown> & { total: number }>(
    `
    WITH ${b},
    risk AS (
      SELECT lc.id AS loan_id, lc.customer_id, lc.customer_name, lc.phone_number,
             lc.status::text AS status,
             lc.outstanding::float8 AS outstanding,
             lc.dpd::int AS days_past_due,
             COALESCE(t.missed, 0)::int AS missed_weeks,
             COALESCE(t.partial, 0)::int AS partial_weeks,
             (SELECT COUNT(*) FROM loans d
               WHERE d.customer_id = lc.customer_id
                 AND d.status = 'DEFAULTED' AND d.id <> lc.id)::int AS past_defaults,
             EXISTS (SELECT 1 FROM loans rl
                      WHERE rl.customer_id = lc.referred_by_id
                        AND rl.status IN ('OVERDUE','DEFAULTED')) AS referrer_at_risk
      FROM lc
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE rt.status = 'UNPAID') AS missed,
               COUNT(*) FILTER (WHERE rt.status = 'PARTIAL') AS partial
        FROM repayment_tracks rt
        WHERE rt.loan_id = lc.id
          AND (lc.issued_date + rt.week_number * 7) < ${TODAY}
      ) t ON true
      WHERE lc.status IN (${LIVE}) AND lc.outstanding > 0
    )
    SELECT r.*,
           LEAST(100,
             r.days_past_due * 1.5 + r.missed_weeks * 6 + r.partial_weeks * 2
             + r.past_defaults * 20 + CASE WHEN r.referrer_at_risk THEN 5 ELSE 0 END
           )::float8 AS risk_score,
           COUNT(*) OVER()::int AS total
    FROM risk r
    ORDER BY risk_score DESC, r.outstanding DESC
    LIMIT $${lIdx} OFFSET $${oIdx}
    `,
    values,
  );
  const total = result[0]?.total ?? 0;
  return { rows: result.map(({ total: _t, ...r }) => r), total };
}

export async function getRepeatBorrowersRepo(scope: Scope): Promise<{
  customers_with_loans: number;
  repeat_customers: number;
  avg_loans: number;
  completed_customers: number;
  returned_customers: number;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
}> {
  const values: unknown[] = [];
  const b = base(scope, values);
  const result = await rows<any>(
    `
    WITH ${b},
    per AS (
      SELECT customer_id,
             COUNT(*) AS loans,
             COUNT(*) FILTER (WHERE status IN ('PAID_OFF','CLOSED')) AS completed
      FROM sl GROUP BY customer_id
    )
    SELECT COUNT(*)::int AS customers_with_loans,
           COUNT(*) FILTER (WHERE loans >= 2)::int AS repeat_customers,
           COALESCE(AVG(loans), 0)::float8 AS avg_loans,
           COUNT(*) FILTER (WHERE completed >= 1)::int AS completed_customers,
           COUNT(*) FILTER (WHERE completed >= 1 AND loans > completed)::int AS returned_customers,
           COUNT(*) FILTER (WHERE loans = 1)::int AS c1,
           COUNT(*) FILTER (WHERE loans = 2)::int AS c2,
           COUNT(*) FILTER (WHERE loans = 3)::int AS c3,
           COUNT(*) FILTER (WHERE loans >= 4)::int AS c4
    FROM per
    `,
    values,
  );
  return result[0];
}

export async function getReferralPerformanceRepo(
  scope: Scope,
  limit: number,
): Promise<
  {
    referrer_id: string;
    customer_name: string;
    referred: number;
    converted: number;
    at_risk: number;
  }[]
> {
  const values: unknown[] = [];
  const clause = customerScope(scope, values);
  values.push(limit);
  return rows(
    `
    SELECT u.id AS referrer_id,
           u.customer_name,
           COUNT(c.id)::int AS referred,
           COUNT(c.id) FILTER (
             WHERE EXISTS (SELECT 1 FROM loans WHERE customer_id = c.id)
           )::int AS converted,
           COUNT(c.id) FILTER (
             WHERE EXISTS (SELECT 1 FROM loans
                            WHERE customer_id = c.id AND status IN ('OVERDUE','DEFAULTED'))
           )::int AS at_risk
    FROM customers u
    JOIN customers c ON c.referred_by_id = u.id
    WHERE 1 = 1 ${clause}
    GROUP BY u.id, u.customer_name
    ORDER BY referred DESC, converted DESC
    LIMIT $${values.length}
    `,
    values,
  );
}

export async function getGeographyRepo(
  scope: Scope,
  level: "district" | "city",
): Promise<
  {
    area: string;
    borrowers: number;
    active_loans: number;
    overdue_loans: number;
    disbursed: number;
    outstanding: number;
    par_amount: number;
  }[]
> {
  const col = level === "city" ? "city" : "district";
  const values: unknown[] = [];
  const b = base(scope, values);
  return rows(
    `
    WITH ${b}
    SELECT COALESCE(NULLIF(${col}, ''), 'Unknown') AS area,
           COUNT(DISTINCT customer_id)::int AS borrowers,
           COUNT(*) FILTER (WHERE status IN ('ACTIVE','OVERDUE'))::int AS active_loans,
           COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_loans,
           COALESCE(SUM(disbursed_amount), 0)::float8 AS disbursed,
           COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0), 0)::float8 AS outstanding,
           COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0 AND dpd > 0), 0)::float8 AS par_amount
    FROM lc
    GROUP BY 1
    ORDER BY outstanding DESC
    LIMIT 50
    `,
    values,
  );
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

// users.user_name is the display name; email is optional, so fall back to phone.
const USER_NAME = (alias: string) =>
  `COALESCE(NULLIF(${alias}.user_name, ''), NULLIF(${alias}.email, ''), ${alias}.phone_number)`;

export async function findEmployeeRepo(id: string): Promise<{
  id: string;
  name: string | null;
  admin_id: string | null;
} | null> {
  const r = await rows<any>(
    `SELECT e.id, ${USER_NAME("e")} AS name, e.admin_id
     FROM users e WHERE e.id = $1 AND e.role = 'USER'`,
    [id],
  );
  return r[0] ?? null;
}

export async function getEmployeePerformanceRepo(
  scope: { owningAdminId?: string },
  from: string,
  to: string,
  page: number,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const values: unknown[] = [];
  const b = base({ owningAdminId: scope.owningAdminId }, values);
  let empFilter = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    empFilter = ` AND e.admin_id = $${values.length}`;
  }
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;
  values.push(limit, (page - 1) * limit);
  const lIdx = values.length - 1;
  const oIdx = values.length;

  const result = await rows<Record<string, unknown> & { total: number }>(
    `
    WITH ${b},
    emp AS (
      SELECT e.id, ${USER_NAME("e")} AS name, e.admin_id
      FROM users e WHERE e.role = 'USER' ${empFilter}
    ),
    cust AS (
      SELECT created_by AS emp_id, COUNT(*)::int AS customers
      FROM customers WHERE created_by IN (SELECT id FROM emp) GROUP BY 1
    ),
    la AS (
      SELECT customer_created_by AS emp_id,
             COUNT(*)::int AS loans,
             COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_loans,
             COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_loans,
             COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0), 0) AS outstanding,
             COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0 AND dpd > 0), 0) AS par_amount,
             COALESCE(SUM(LEAST(collected, expected_to_date)), 0) AS on_schedule,
             COALESCE(SUM(expected_to_date), 0) AS expected
      FROM lc GROUP BY 1
    ),
    pa AS (
      SELECT sl.customer_created_by AS emp_id,
             SUM(p.amount_paid) AS collected_in_range
      FROM payments p
      JOIN sl ON sl.id = p.loan_id
      WHERE (p.paid_at AT TIME ZONE '${TZ}')::date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1
    )
    SELECT emp.id AS employee_id, emp.name, emp.admin_id,
           ${USER_NAME("a")} AS admin_name,
           COALESCE(cust.customers, 0)::int AS customers,
           COALESCE(la.loans, 0)::int AS loans,
           COALESCE(la.active_loans, 0)::int AS active_loans,
           COALESCE(la.overdue_loans, 0)::int AS overdue_loans,
           COALESCE(la.outstanding, 0)::float8 AS outstanding,
           COALESCE(la.par_amount, 0)::float8 AS par_amount,
           COALESCE(la.on_schedule, 0)::float8 AS on_schedule_collected,
           COALESCE(la.expected, 0)::float8 AS expected_to_date,
           COALESCE(pa.collected_in_range, 0)::float8 AS collected_in_range,
           COUNT(*) OVER()::int AS total
    FROM emp
    LEFT JOIN users a ON a.id = emp.admin_id
    LEFT JOIN cust ON cust.emp_id = emp.id
    LEFT JOIN la ON la.emp_id = emp.id
    LEFT JOIN pa ON pa.emp_id = emp.id
    ORDER BY collected_in_range DESC, customers DESC
    LIMIT $${lIdx} OFFSET $${oIdx}
    `,
    values,
  );
  const total = result[0]?.total ?? 0;
  return { rows: result.map(({ total: _t, ...r }) => r), total };
}

// ---------------------------------------------------------------------------
// Super admin (platform) queries
// ---------------------------------------------------------------------------

export async function getPlatformCountsRepo(): Promise<{
  admins: number;
  employees: number;
  super_admins: number;
}> {
  const r = await rows<any>(
    `SELECT COUNT(*) FILTER (WHERE role = 'ADMIN')::int AS admins,
            COUNT(*) FILTER (WHERE role = 'USER')::int AS employees,
            COUNT(*) FILTER (WHERE role = 'SUPER_ADMIN')::int AS super_admins
     FROM users`,
    [],
  );
  return r[0];
}

export async function getAdminsPerformanceRepo(
  from: string,
  to: string,
): Promise<Record<string, unknown>[]> {
  const values: unknown[] = [];
  const b = base({}, values);
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;
  return rows(
    `
    WITH ${b},
    adm AS (
      SELECT a.id, ${USER_NAME("a")} AS name
      FROM users a
      WHERE (
        -- admins are always listed (inactive ones only if they still own data)
        a.role = 'ADMIN' AND (
          a.is_active
          OR EXISTS (SELECT 1 FROM loans l WHERE l.owning_admin_id = a.id)
          OR EXISTS (SELECT 1 FROM customers c WHERE c.owning_admin_id = a.id)
        )
      ) OR (
        -- a super admin appears only when it owns loans or customers itself
        a.role = 'SUPER_ADMIN' AND (
          EXISTS (SELECT 1 FROM loans l WHERE l.owning_admin_id = a.id)
          OR EXISTS (SELECT 1 FROM customers c WHERE c.owning_admin_id = a.id)
        )
      )
    ),
    agg AS (
      SELECT owning_admin_id AS admin_id,
             COUNT(*)::int AS loans,
             COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_loans,
             COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_loans,
             COUNT(*) FILTER (WHERE status = 'DEFAULTED')::int AS defaulted_loans,
             COALESCE(SUM(disbursed_amount) FILTER (WHERE issued_date BETWEEN $${f}::date AND $${t}::date), 0) AS disbursed_in_range,
             COALESCE(SUM(upfront_fee) FILTER (WHERE issued_date BETWEEN $${f}::date AND $${t}::date), 0) AS fees_in_range,
             COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0), 0) AS outstanding,
             COALESCE(SUM(outstanding) FILTER (WHERE status IN (${LIVE}) AND outstanding > 0 AND dpd > 0), 0) AS par_amount,
             COALESCE(SUM(LEAST(collected, expected_to_date)), 0) AS on_schedule,
             COALESCE(SUM(expected_to_date), 0) AS expected
      FROM lc GROUP BY 1
    ),
    pay AS (
      SELECT sl.owning_admin_id AS admin_id, SUM(p.amount_paid) AS collected_in_range
      FROM payments p
      JOIN sl ON sl.id = p.loan_id
      WHERE (p.paid_at AT TIME ZONE '${TZ}')::date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1
    ),
    cust AS (
      SELECT owning_admin_id AS admin_id, COUNT(*)::int AS customers
      FROM customers GROUP BY 1
    ),
    emp AS (
      SELECT admin_id, COUNT(*)::int AS employees
      FROM users WHERE role = 'USER' GROUP BY 1
    )
    SELECT adm.id AS admin_id, adm.name,
           COALESCE(cust.customers, 0)::int AS customers,
           COALESCE(emp.employees, 0)::int AS employees,
           COALESCE(agg.loans, 0)::int AS loans,
           COALESCE(agg.active_loans, 0)::int AS active_loans,
           COALESCE(agg.overdue_loans, 0)::int AS overdue_loans,
           COALESCE(agg.defaulted_loans, 0)::int AS defaulted_loans,
           COALESCE(agg.disbursed_in_range, 0)::float8 AS disbursed_in_range,
           COALESCE(agg.fees_in_range, 0)::float8 AS fees_in_range,
           COALESCE(pay.collected_in_range, 0)::float8 AS collected_in_range,
           COALESCE(agg.outstanding, 0)::float8 AS outstanding,
           COALESCE(agg.par_amount, 0)::float8 AS par_amount,
           COALESCE(agg.on_schedule, 0)::float8 AS on_schedule_collected,
           COALESCE(agg.expected, 0)::float8 AS expected_to_date
    FROM adm
    LEFT JOIN agg ON agg.admin_id = adm.id
    LEFT JOIN pay ON pay.admin_id = adm.id
    LEFT JOIN cust ON cust.admin_id = adm.id
    LEFT JOIN emp ON emp.admin_id = adm.id
    ORDER BY collected_in_range DESC, outstanding DESC
    `,
    values,
  );
}

export async function getAdminsGrowthRepo(
  from: string,
  to: string,
  groupBy: GroupBy,
): Promise<Record<string, unknown>[]> {
  const values: unknown[] = [];
  const b = base({}, values);
  values.push(from, to);
  const f = values.length - 1;
  const t = values.length;
  return rows(
    `
    WITH ${b},
    newc AS (
      SELECT ${trunc(groupBy, `created_at AT TIME ZONE '${TZ}'`)} AS bucket,
             owning_admin_id AS admin_id, COUNT(*)::int AS new_customers
      FROM customers
      WHERE (created_at AT TIME ZONE '${TZ}')::date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1, 2
    ),
    newl AS (
      SELECT ${trunc(groupBy, "issued_date")} AS bucket,
             owning_admin_id AS admin_id,
             COUNT(*)::int AS loans_issued,
             COALESCE(SUM(disbursed_amount), 0) AS disbursed
      FROM lc
      WHERE issued_date BETWEEN $${f}::date AND $${t}::date
      GROUP BY 1, 2
    )
    SELECT COALESCE(n.bucket, l.bucket)::text AS period,
           COALESCE(n.admin_id, l.admin_id) AS admin_id,
           ${USER_NAME("a")} AS admin_name,
           COALESCE(n.new_customers, 0)::int AS new_customers,
           COALESCE(l.loans_issued, 0)::int AS loans_issued,
           COALESCE(l.disbursed, 0)::float8 AS disbursed
    FROM newc n
    FULL OUTER JOIN newl l ON l.bucket = n.bucket AND l.admin_id = n.admin_id
    LEFT JOIN users a ON a.id = COALESCE(n.admin_id, l.admin_id)
    ORDER BY 1, 3
    `,
    values,
  );
}

export async function getRiskConcentrationRepo(limit: number): Promise<{
  by_admin: Record<string, unknown>[];
  top_exposures: Record<string, unknown>[];
}> {
  const v1: unknown[] = [];
  const b1 = base({}, v1);
  const byAdmin = await rows(
    `
    WITH ${b1}
    SELECT g.admin_id,
           ${USER_NAME("a")} AS admin_name,
           g.loans, g.outstanding, g.par_amount
    FROM (
      SELECT lc.owning_admin_id AS admin_id,
             COUNT(*)::int AS loans,
             COALESCE(SUM(lc.outstanding), 0)::float8 AS outstanding,
             COALESCE(SUM(lc.outstanding) FILTER (WHERE lc.dpd > 0), 0)::float8 AS par_amount
      FROM lc
      WHERE lc.status IN (${LIVE}) AND lc.outstanding > 0
      GROUP BY lc.owning_admin_id
    ) g
    LEFT JOIN users a ON a.id = g.admin_id
    ORDER BY g.outstanding DESC
    `,
    v1,
  );

  const v2: unknown[] = [];
  const b2 = base({}, v2);
  v2.push(limit);
  const top = await rows(
    `
    WITH ${b2}
    SELECT lc.id AS loan_id, lc.customer_id, lc.customer_name,
           lc.owning_admin_id AS admin_id,
           lc.status::text AS status,
           lc.outstanding::float8 AS outstanding,
           lc.dpd::int AS days_past_due
    FROM lc
    WHERE lc.status IN (${LIVE}) AND lc.outstanding > 0
    ORDER BY lc.outstanding DESC
    LIMIT $${v2.length}
    `,
    v2,
  );
  return { by_admin: byAdmin, top_exposures: top };
}

export async function getAccountsSummaryRepo(): Promise<{
  by_role: Record<string, unknown>[];
  employees_per_admin: Record<string, unknown>[];
}> {
  // is_active / is_verified are read defensively; missing columns count as true
  const flag = (col: string) =>
    `COALESCE((to_jsonb(u)->>'${col}')::boolean, true)`;
  const byRole = await rows(
    `SELECT u.role::text AS role,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ${flag("is_active")})::int AS active,
            COUNT(*) FILTER (WHERE NOT ${flag("is_active")})::int AS inactive,
            COUNT(*) FILTER (WHERE NOT ${flag("is_verified")})::int AS pending_verification
     FROM users u GROUP BY u.role ORDER BY u.role`,
    [],
  );
  const perAdmin = await rows(
    `SELECT a.id AS admin_id, ${USER_NAME("a")} AS admin_name,
            (SELECT COUNT(*) FROM users e
              WHERE e.admin_id = a.id AND e.role = 'USER')::int AS employees
     FROM users a
     WHERE a.role = 'ADMIN'
     ORDER BY employees DESC`,
    [],
  );
  return { by_role: byRole, employees_per_admin: perAdmin };
}
