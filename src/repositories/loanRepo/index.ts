import { PoolClient } from "pg";
import { getPool } from "../../config/database";
import {
  CreateLoanPayload,
  Loan,
  LoanStatus,
  RepaymentTrack,
  Payment,
  PaymentStatus,
  ListLoansFilters,
  LoanListRow,
  Weekday,
  ActiveLoanRow,
  PaymentWithWeek,
  CollectionDueRow,
  LoanDetailRow,
} from "../../types/loanTypes";

export async function createLoanRepo(
  payload: CreateLoanPayload,
): Promise<Loan> {
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
        INSERT INTO loans (customer_id, issued_by_admin_id, owning_admin_id, nominal_amount, upfront_fee, disbursed_amount, total_payable_amount, weekly_payable_amount, total_months, total_weeks, issued_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        payload.customer_id,
        payload.issued_by_admin_id,
        payload.owning_admin_id,
        payload.nominal_amount,
        payload.upfront_fee,
        payload.disbursed_amount,
        payload.total_payable_amount,
        payload.weekly_payable_amount,
        payload.total_months,
        payload.total_weeks,
        payload.issued_at,
      ],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Runs on single transaction
export async function findLoanByIdForUpdateRepo(
  client: PoolClient,
  loanId: string,
): Promise<Loan | null> {
  const result = await client.query(
    `
    SELECT * FROM loans WHERE id = $1 FOR UPDATE
    `,
    [loanId],
  );

  return result.rows[0] ?? null;
}

export async function updateLoanStatusRepo(
  client: PoolClient,
  loanId: string,
  status: LoanStatus,
): Promise<void> {
  await client.query(
    `
      UPDATE loans SET status = $1 WHERE id = $2
    `,
    [status, loanId],
  );
}

export async function findOrCreateTrackForUpdateRepo(
  client: PoolClient,
  loanId: string,
  weekNumber: number,
  targetAmount: number,
  isOverdued: boolean,
): Promise<RepaymentTrack> {
  const inserted = await client.query(
    `
      INSERT INTO repayment_tracks (loan_id, week_number, target_amount, is_overdued)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (loan_id, week_number) DO NOTHING
      RETURNING *
    `,
    [loanId, weekNumber, targetAmount, isOverdued],
  );

  if (inserted.rows[0]) {
    return inserted.rows[0];
  }

  const existing = await client.query(
    `
      SELECT * FROM repayment_tracks
      WHERE loan_id = $1 AND week_number = $2 FOR UPDATE
    `,
    [loanId, weekNumber],
  );

  return existing.rows[0];
}

export async function findActiveLoanByCustomerIdRepo(
  customerId: string,
): Promise<Loan | null> {
  const result = await getPool().query<Loan>(
    `SELECT * FROM loans WHERE customer_id = $1 AND status IN ('ACTIVE', 'OVERDUE') LIMIT 1`,
    [customerId],
  );
  return result.rows[0] ?? null;
}

export async function insertPaymentRepo(
  client: PoolClient,
  trackId: string,
  loanId: string,
  amountPaid: number,
  collectedByAdminId: string,
): Promise<Payment> {
  const result = await client.query(
    `
      INSERT INTO payments (track_id, loan_id, amount_paid, collected_by_admin_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [trackId, loanId, amountPaid, collectedByAdminId],
  );

  return result.rows[0];
}

export async function updateRepaymentTrackAfterPaymentRepo(
  client: PoolClient,
  trackId: string,
  newTotalCollected: number,
  status: PaymentStatus,
): Promise<RepaymentTrack> {
  const result = await client.query(
    `
      UPDATE repayment_tracks SET total_collected = $1, status = $2
      WHERE id = $3
      RETURNING *
    `,
    [newTotalCollected, status, trackId],
  );

  return result.rows[0];
}

export async function sumTotalCollectedForLoanRepo(
  client: PoolClient,
  loanId: string,
): Promise<number> {
  const result = await client.query(
    `
      SELECT COALESCE(SUM(total_collected), 0)::int AS total FROM repayment_tracks
      WHERE loan_id = $1
    `,
    [loanId],
  );

  return result.rows[0].total;
}
// End of single transaction functions

export async function findLoanByIdRepo(loanId: string): Promise<Loan | null> {
  const result = await getPool().query(
    `
      SELECT * FROM loans WHERE id = $1
    `,
    [loanId],
  );

  return result.rows[0] ?? null;
}

export async function getLoanTotalsRepo(loanId: string): Promise<{
  total_collected: number;
  paid_weeks: number;
  partial_weeks: number;
}> {
  const result = await getPool().query(
    `
      SELECT
        COALESCE(SUM(total_collected), 0)::int AS total_collected,
        COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_weeks,
        COUNT(*) FILTER (WHERE status = 'PARTIAL')::int AS partial_weeks
      FROM repayment_tracks
      WHERE loan_id = $1
    `,
    [loanId],
  );

  return result.rows[0];
}

export async function findLoanWithDetailsRepo(
  id: string,
): Promise<LoanDetailRow | null> {
  const result = await getPool().query(
    `
      SELECT
        l.*,
        COALESCE(t.total_collected, 0)::int AS total_collected,
        COALESCE(t.paid_weeks, 0)::int AS paid_weeks,
        COALESCE(t.partial_weeks, 0)::int AS partial_weeks,
        COALESCE(t.tracks, '[]'::json) AS tracks
      FROM loans l
      LEFT JOIN LATERAL (
        SELECT
          SUM(rt.total_collected) AS total_collected,
          COUNT(*) FILTER (WHERE rt.status = 'PAID') AS paid_weeks,
          COUNT(*) FILTER (WHERE rt.status = 'PARTIAL') AS partial_weeks,
          json_agg(rt.* ORDER BY rt.week_number) AS tracks
        FROM repayment_tracks rt
        WHERE rt.loan_id = l.id
      ) t ON true
      WHERE l.id = $1
    `,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listTracksByLoanIdRepo(
  loanId: string,
): Promise<RepaymentTrack[]> {
  const result = await getPool().query(
    `
      SELECT * FROM repayment_tracks WHERE loan_id = $1 ORDER BY week_number ASC
    `,
    [loanId],
  );

  return result.rows;
}

export async function listLoansRepo(
  filters: ListLoansFilters,
): Promise<{ rows: Omit<LoanListRow, "total">[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`l.status = $${values.length}`);
  }
  if (filters.customer_id) {
    values.push(filters.customer_id);
    conditions.push(`l.customer_id = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(u.customer_name ILIKE $${values.length} OR u.phone_number ILIKE $${values.length})`,
    );
  }
  if (filters.issued_from) {
    values.push(filters.issued_from);
    conditions.push(`l.issued_at >= $${values.length}`);
  }
  if (filters.issued_to) {
    values.push(filters.issued_to);
    conditions.push(`l.issued_at <= $${values.length}`);
  }
  if (filters.owning_admin_id) {
    values.push(filters.owning_admin_id);
    conditions.push(`l.owning_admin_id = $${values.length}`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const offset = (filters.page - 1) * filters.limit;
  const listValues = [...values, filters.limit, offset];

  const result = await getPool().query(
    `
      SELECT
        l.*,
        u.customer_name,
        u.phone_number,
        COALESCE((SELECT SUM(rt.total_collected) FROM repayment_tracks rt WHERE rt.loan_id = l.id), 0)::int AS total_collected,
        COUNT(*) OVER()::int AS total
      FROM loans l
      JOIN customers u ON u.id = l.customer_id
      ${whereClause}
      ORDER BY l.issued_at DESC
      LIMIT $${listValues.length - 1} OFFSET $${listValues.length}
    `,
    listValues,
  );

  const total = result.rows[0]?.total ?? 0;
  const rows = result.rows.map(({ total: _total, ...row }) => row);
  return { rows, total };
}

export async function listCollectionsDueRepo(
  preferredPaymentDay?: Weekday,
  owningAdminId?: string,
): Promise<CollectionDueRow[]> {
  const values: unknown[] = [];
  let dayFilter = "";

  if (preferredPaymentDay) {
    values.push(preferredPaymentDay);
    dayFilter = `AND u.preferred_payment_day = $1`;
  }
  if (owningAdminId) {
    values.push(owningAdminId);
    dayFilter += ` AND l.owning_admin_id = $${values.length}`;
  }

  const result = await getPool().query(
    `
      SELECT
        l.*,
        u.customer_name,
        u.phone_number,
        u.preferred_payment_day,
        COALESCE(t.total_collected, 0)::int AS total_collected,
        COALESCE(t.tracks, '[]'::json) AS tracks
      FROM loans l
      JOIN customers u ON u.id = l.customer_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(rt.total_collected) AS total_collected,
          json_agg(rt.* ORDER BY rt.week_number) AS tracks
        FROM repayment_tracks rt
        WHERE rt.loan_id = l.id
      ) t ON true
      WHERE l.status IN ('ACTIVE', 'OVERDUE') ${dayFilter}
      ORDER BY u.preferred_payment_day, u.customer_name
    `,
    values,
  );
  return result.rows;
}

export async function listPaymentsByLoanIdRepo(
  loanId: string,
  page: number,
  limit: number,
): Promise<{ rows: PaymentWithWeek[]; total: number }> {
  const offset = (page - 1) * limit;

  const result = await getPool().query(
    `
      SELECT p.*, rt.week_number, COUNT(*) OVER()::int AS total
      FROM payments p
      JOIN repayment_tracks rt ON rt.id = p.track_id
      WHERE p.loan_id = $1
      ORDER BY p.paid_at DESC
      LIMIT $2 OFFSET $3
    `,
    [loanId, limit, offset],
  );

  const total = result.rows[0]?.total ?? 0;
  const rows = result.rows.map(({ total: _total, ...row }) => row);
  return { rows, total };
}

export async function setLoanClosedAtRepo(
  client: PoolClient,
  loanId: string,
): Promise<void> {
  await client.query(
    `UPDATE loans SET closed_at = now() WHERE id = $1 AND closed_at IS NULL`,
    [loanId],
  );
}
