import { getPool } from "../../config/database";
import { OverdueLoanRow } from "../../types/reportTypes";

export async function getCashOutstandingTotalsRepo(): Promise<{
  active_loans: number;
  total_disbursed: number;
  total_payable: number;
  total_collected: number;
}> {
  const result = await getPool().query(
    `
      SELECT
        COUNT(*)::int AS active_loans,
        COALESCE(SUM(l.disbursed_amount), 0)::int AS total_disbursed,
        COALESCE(SUM(l.total_payable_amount), 0)::int AS total_payable,
        COALESCE(SUM(c.collected), 0)::int AS total_collected
      FROM loans l
      LEFT JOIN (
        SELECT loan_id, SUM(total_collected) AS collected
        FROM repayment_tracks
        GROUP BY loan_id
      ) c ON c.loan_id = l.id
      WHERE l.STATUS IN ('ACTIVE', 'OVERDUE', 'DEFAULTED')
    `,
  );

  return result.rows[0];
}

export async function getEarningsTotalsRepo(): Promise<{
  fees_earned: number;
  interest_earned: number;
  interest_expected: number;
}> {
  const result = await getPool().query(
    `
      SELECT
        COALESCE(SUM(l.upfront_fee), 0)::int AS fees_earned,
        COALESCE(SUM(GREATEST(COALESCE(c.collected, 0) - l.nominal_amount, 0)), 0)::int AS interest_earned,
        COALESCE(SUM(l.total_payable_amount - l.nominal_amount), 0)::int AS interest_expected
      FROM loans l
      LEFT JOIN (
        SELECT loan_id, SUM(total_collected) AS collected
        FROM repayment_tracks
        GROUP BY loan_id
      ) c ON c.loan_id = l.id
    `,
  );

  return result.rows[0];
}

export async function getOverdueLoans(): Promise<OverdueLoanRow[]> {
  const result = await getPool().query(
    `
      SELECT *
      FROM (
        SELECT
          l.*,
          u.user_name,
          u.phone_number,
          COALESCE(c.collected, 0)::int AS total_collected,
          (l.total_payable_amount - COALESCE(c.collected, 0))::int AS outstanding_balance,
          GREATEST(
            0,
            (now()::date - (l.issued_at + (l.total_weeks * interval '7 days'))::date)
          )::int AS days_past_due
        FROM loans l
        JOIN users u ON u.id = l.user_id
        LEFT JOIN (
          SELECT loan_id, SUM(total_collected) AS collected
          FROM repayment_tracks
          GROUP BY loan_id
        ) c ON c.loan_id = l.id
        WHERE l.status IN ('ACTIVE', 'OVERDUE', 'DEFAULTED')
      ) x
      WHERE x.outstanding_balance > 0
        AND (
          x.status IN ('OVERDUE', 'DEFAULTED')
          OR (x.status = 'ACTIVE' AND x.days_past_due > 0)
        )
      ORDER BY x.days_past_due DESC, x.outstanding_balance DESC
    `,
  );

  return result.rows;
}
