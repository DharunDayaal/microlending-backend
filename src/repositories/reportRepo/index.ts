import { getPool } from "../../config/database";
import { OverdueLoanRow } from "../../types/reportTypes";

export type ReportScope = {
  owningAdminId?: string; // loans.owning_admin_id (ADMIN / USER)
  createdBy?: string; // customers.created_by (USER)
};

/**
 * Builds the " AND ..." scope clause. Expects `l` = loans, `u` = customers.
 * Returned values start at $1, so callers that need more params append after.
 */
function buildScope(scope: ReportScope): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND l.owning_admin_id = $${values.length}`;
  }
  if (scope.createdBy) {
    values.push(scope.createdBy);
    clause += ` AND u.created_by = $${values.length}`;
  }
  return { clause, values };
}

export async function getCashOutstandingTotalsRepo(
  scope: ReportScope = {},
): Promise<{
  active_loans: number;
  total_disbursed: number;
  total_payable: number;
  total_collected: number;
}> {
  const { clause, values } = buildScope(scope);
  const result = await getPool().query(
    `
      SELECT
        COUNT(*)::int AS active_loans,
        COALESCE(SUM(l.disbursed_amount), 0)::int AS total_disbursed,
        COALESCE(SUM(l.total_payable_amount), 0)::int AS total_payable,
        COALESCE(SUM(c.collected), 0)::int AS total_collected
      FROM loans l
      JOIN customers u ON u.id = l.customer_id
      LEFT JOIN (
        SELECT loan_id, SUM(total_collected) AS collected
        FROM repayment_tracks
        GROUP BY loan_id
      ) c ON c.loan_id = l.id
      WHERE l.STATUS IN ('ACTIVE', 'OVERDUE', 'DEFAULTED') ${clause}
    `,
    values,
  );

  return result.rows[0];
}

export async function getEarningsTotalsRepo(scope: ReportScope = {}): Promise<{
  fees_earned: number;
  interest_earned: number;
  interest_expected: number;
}> {
  const { clause, values } = buildScope(scope);
  const result = await getPool().query(
    `
      SELECT
        COALESCE(SUM(l.upfront_fee), 0)::int AS fees_earned,
        COALESCE(SUM(GREATEST(COALESCE(c.collected, 0) - l.nominal_amount, 0)), 0)::int AS interest_earned,
        COALESCE(SUM(l.total_payable_amount - l.nominal_amount), 0)::int AS interest_expected
      FROM loans l
      JOIN customers u ON u.id = l.customer_id
      LEFT JOIN (
        SELECT loan_id, SUM(total_collected) AS collected
        FROM repayment_tracks
        GROUP BY loan_id
      ) c ON c.loan_id = l.id
      WHERE 1 = 1 ${clause}
    `,
    values,
  );

  return result.rows[0];
}

export async function getOverdueLoans(
  page: number,
  limit: number,
  scope: ReportScope = {},
): Promise<{ rows: OverdueLoanRow[]; total: number }> {
  const offset = (page - 1) * limit;
  const { clause, values } = buildScope(scope);
  values.push(limit, offset);
  const limitIndex = values.length - 1;
  const offsetIndex = values.length;

  const result = await getPool().query(
    `
      SELECT x.*, COUNT(*) OVER()::int AS total
      FROM (
        SELECT
          l.*,
          u.customer_name,
          u.phone_number,
          COALESCE(c.collected, 0)::int AS total_collected,
          (l.total_payable_amount - COALESCE(c.collected, 0))::int AS outstanding_balance,
          GREATEST(
            0,
            (now() AT TIME ZONE 'Asia/Kolkata')::date
              - ((l.issued_at AT TIME ZONE 'Asia/Kolkata')::date + l.total_weeks * 7)
          )::int AS days_past_due
        FROM loans l
        JOIN customers u ON u.id = l.customer_id
        LEFT JOIN (
          SELECT loan_id, SUM(total_collected) AS collected
          FROM repayment_tracks
          GROUP BY loan_id
        ) c ON c.loan_id = l.id
        WHERE l.status IN ('ACTIVE', 'OVERDUE', 'DEFAULTED') ${clause}
      ) x
      WHERE x.outstanding_balance > 0
        AND (
          x.status IN ('OVERDUE', 'DEFAULTED')
          OR (x.status = 'ACTIVE' AND x.days_past_due > 0)
        )
      ORDER BY x.days_past_due DESC, x.outstanding_balance DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    values,
  );

  const total = result.rows[0]?.total ?? 0;
  const rows = result.rows.map(({ total: _total, ...row }) => row);
  return { rows, total };
}
