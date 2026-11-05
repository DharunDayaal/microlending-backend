import { getPool } from "../../config/database";
import type { Scope } from "../analyticsRepo";

const TZ = "Asia/Kolkata";
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;

/** " AND <loanAlias>.owning_admin_id = $n AND <custAlias>.created_by = $m" */
function scopeClause(
  scope: Scope,
  values: unknown[],
  ownerCol: string,
  creatorCol: string,
): string {
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND ${ownerCol} = $${values.length}`;
  }
  if (scope.createdBy) {
    values.push(scope.createdBy);
    clause += ` AND ${creatorCol} = $${values.length}`;
  }
  return clause;
}

// New customers in a period
export async function getNewCustomersRepo(
  scope: Scope,
  from: string,
  to: string,
): Promise<number> {
  const values: unknown[] = [from, to];
  const clause = scopeClause(scope, values, "u.owning_admin_id", "u.created_by");
  const response = await getPool().query(
    `
      SELECT COUNT(*)::int AS n
        FROM customers u
      WHERE (u.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        ${clause}
    `,
    values,
  );
  return response.rows[0].n as number;
}

// Cohorts (vintage): loans grouped by issue month, collected vs payable by
// week since issue. A loan only counts toward week N once N weeks have passed.
export interface CohortSizeRow {
  cohort: string;
  loans: number;
  nominal: number;
  defaulted: number;
}

export interface CohortCurveRow {
  cohort: string;
  week: number;
  loans: number; // loans old enough to be observed at this week
  payable: number;
  expected: number;
  collected: number;
}

export async function getCohortsRepo(
  scope: Scope,
  fromDate: string,
  weeks: number,
): Promise<{ sizes: CohortSizeRow[]; curve: CohortCurveRow[] }> {
  const buildLoans = (values: unknown[]) => {
    const clause = scopeClause(scope, values, "l.owning_admin_id", "u.created_by");
    values.push(fromDate);
    const f = values.length;
    return `
      ld AS (
        SELECT l.id, l.status::text AS status,
               (l.issued_at AT TIME ZONE '${TZ}')::date AS issued_date,
               l.nominal_amount, l.total_payable_amount,
               l.weekly_payable_amount, l.total_weeks
        FROM loans l
        JOIN customers u ON u.id = l.customer_id
        WHERE (l.issued_at AT TIME ZONE '${TZ}')::date >= $${f}::date ${clause}
      )
    `;
  };

  const v1: unknown[] = [];
  const sizesSql = `
    WITH ${buildLoans(v1)}
    SELECT date_trunc('month', issued_date)::date::text AS cohort,
           COUNT(*)::int AS loans,
           COALESCE(SUM(nominal_amount), 0)::float8 AS nominal,
           COUNT(*) FILTER (WHERE status = 'DEFAULTED')::int AS defaulted
    FROM ld GROUP BY 1 ORDER BY 1`;

  const v2: unknown[] = [];
  const ld2 = buildLoans(v2);
  v2.push(weeks);
  const w = v2.length;
  const curveSql = `
    WITH ${ld2},
    cum AS (
      SELECT date_trunc('month', ld.issued_date)::date AS cohort,
             g.w AS week,
             ld.total_payable_amount AS payable,
             LEAST(ld.total_payable_amount,
                   LEAST(g.w, ld.total_weeks) * ld.weekly_payable_amount) AS expected,
             LEAST(ld.total_payable_amount, COALESCE((
               SELECT SUM(p.amount_paid) FROM payments p
                WHERE p.loan_id = ld.id
                  AND (p.paid_at AT TIME ZONE '${TZ}')::date <= ld.issued_date + g.w * 7
             ), 0)) AS paid
      FROM ld
      CROSS JOIN generate_series(1, $${w}::int) AS g(w)
      WHERE ld.issued_date + g.w * 7 <= ${TODAY}
    )
    SELECT cohort::text AS cohort, week,
           COUNT(*)::int AS loans,
           SUM(payable)::float8 AS payable,
           SUM(expected)::float8 AS expected,
           SUM(paid)::float8 AS collected
    FROM cum GROUP BY 1, 2 ORDER BY 1, 2`;

  const [sizes, curve] = await Promise.all([
    getPool().query(sizesSql, v1),
    getPool().query(curveSql, v2),
  ]);
  return {
    sizes: sizes.rows as CohortSizeRow[],
    curve: curve.rows as CohortCurveRow[],
  };
}