import { Pool, PoolClient } from "pg";
import { getPool } from "../../config/database";
import { CreateUserSchema } from "../../schemas/userSchema";
import {
  CustomerProfile,
  DashboardSummary,
  FlatCustomerProfile,
  GetUsersOnWeekdayPayload,
  ListUsersFilters,
  UpdateUserPayload,
  User,
  UserLoanRow,
} from "../../types/userTypes";

export type CustomerScope = { owningAdminId?: string; createdBy?: string };

export async function createUserRepo(
  payload: CreateUserSchema,
  createdBy: string,
  owningAdminId: string,
  client: Pool | PoolClient = getPool(),
): Promise<User> {
  const result = await client.query(
    `
      INSERT INTO customers (customer_name, phone_number, referred_by_id, preferred_payment_day, created_by, owning_admin_id, street_name, city, district)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      payload.customer_name,
      payload.phone_number,
      payload.referred_by_id ?? null,
      payload.preferred_payment_day ?? null,
      createdBy,
      owningAdminId,
      payload.street_name ?? null,
      payload.city,
      payload.district,
    ],
  );

  return result.rows[0];
}

export async function getUsersOnWeekdayRepo(
  payload: GetUsersOnWeekdayPayload,
): Promise<User[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const hasSearch =
    payload.search !== undefined &&
    payload.search !== null &&
    payload.search.trim() !== "";

  let searchParamIndex: number | null = null;

  // 1. Weekday filter
  if (payload.weekday !== undefined && payload.weekday !== null) {
    values.push(payload.weekday);
    conditions.push(`preferred_payment_day = $${values.length}`);
  }

  // 2. Search filter
  if (hasSearch) {
    const search = payload.search!.trim();

    values.push(search);
    searchParamIndex = values.length;

    conditions.push(`
      (
        fts_search_vector @@ websearch_to_tsquery(
          'english',
          $${searchParamIndex}
        )
        OR similarity(
          customer_name,
          $${searchParamIndex}
        ) > 0.25
        OR phone_number ILIKE '%' || $${searchParamIndex} || '%'
        OR street_name ILIKE '%' || $${searchParamIndex} || '%'
        OR city ILIKE '%' || $${searchParamIndex} || '%'
        OR district ILIKE '%' || $${searchParamIndex} || '%'
      )
    `);
  }

  // 3. Owning admin filter
  if (payload.owningAdminId) {
    values.push(payload.owningAdminId);
    conditions.push(`owning_admin_id = $${values.length}`);
  }

  // 4. Creator filter (employees only see customers they created)
  if (payload.createdBy) {
    values.push(payload.createdBy);
    conditions.push(`created_by = $${values.length}`);
  }

  if (conditions.length === 0) {
    conditions.push("1=1");
  }

  // 5. Pagination
  values.push(payload.limit);
  const limitIndex = values.length;

  values.push(payload.startIndex);
  const offsetIndex = values.length;

  // 6. Ranking
  let orderBy = `created_at DESC`;

  if (hasSearch && searchParamIndex !== null) {
    orderBy = `
      GREATEST(
        similarity(customer_name, $${searchParamIndex}),
        similarity(phone_number, $${searchParamIndex}),
        similarity(city, $${searchParamIndex}),
        similarity(district, $${searchParamIndex})
      ) DESC,
      created_at DESC
    `;
  }

  const result = await getPool().query<User>(
    `
      SELECT
        id,
        customer_name,
        phone_number,
        referred_by_id,
        preferred_payment_day,
        preferred_payment_time,
        created_at,
        owning_admin_id,
        created_by,
        street_name,
        city,
        district
      FROM customers
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    values,
  );

  return result.rows;
}

/**
 * Lightweight lookup used only for access checks (and loan-issue ownership).
 */
export async function findCustomerAccessInfoRepo(customerId: string): Promise<{
  id: string;
  owning_admin_id: string;
  created_by: string;
} | null> {
  const result = await getPool().query(
    `SELECT id, owning_admin_id, created_by FROM customers WHERE id = $1`,
    [customerId],
  );
  return result.rows[0] ?? null;
}

export async function getUserByIdRepo(
  userId: string,
): Promise<CustomerProfile | null> {
  const result = await getPool().query<FlatCustomerProfile>(
    `
    SELECT c.*, r.customer_name AS referred_by_name,
    CASE
      WHEN r.id IS NULL THEN NULL
      WHEN EXISTS ( SELECT 1 FROM loans WHERE customer_id = r.id AND status IN ('OVERDUE', 'DEFAULTED') ) THEN 'NEEDS_ATTENTION'
      ELSE 'GOOD_STANDING'
    END AS referred_by_standing,
    COALESCE(credit.on_time_count, 0) AS on_time_count,
    COALESCE(credit.delayed_count, 0) AS delayed_count,
    COALESCE(credit.default_count, 0) AS default_count,
    COALESCE(credit.total_loans, 0) AS total_loans,
    CASE WHEN COALESCE(credit.total_loans, 0) = 0 THEN 0 ELSE round(100.0 * credit.on_time_count / credit.total_loans) END AS on_time_ratio,
    COALESCE(ref.total_referred, 0) AS total_referred,
    COALESCE(ref.active_referred, 0) AS active_referred,
    COALESCE(ref.paired_referred, 0) AS paired_referred,
    CASE WHEN COALESCE(ref.total_referred, 0) = 0 THEN 0 ELSE round(100.0 * ref.paired_referred / ref.total_referred) END AS paired_percentage
    FROM customers c
    LEFT JOIN customers r ON r.id = c.referred_by_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE l.status = 'DEFAULTED') AS default_count,
        COUNT(*) FILTER (
          WHERE l.status IN ('PAID_OFF', 'CLOSED', 'OVERDUE')
          AND EXISTS (SELECT 1 FROM repayment_tracks rt WHERE rt.loan_id = l.id AND rt.is_overdued)
        ) AS delayed_count,
        COUNT(*) FILTER (
          WHERE (l.status IN ('PAID_OFF', 'CLOSED') AND NOT EXISTS (SELECT 1 FROM repayment_tracks rt WHERE rt.loan_id = l.id AND rt.is_overdued))
            OR (l.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM repayment_tracks rt WHERE rt.loan_id = l.id AND rt.is_overdued))
        ) AS on_time_count,
        COUNT(*) AS total_loans
      FROM loans l
      WHERE l.customer_id = c.id
    ) credit ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total_referred,
        COUNT(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM loans WHERE customer_id = ref_c.id AND status IN ('ACTIVE', 'OVERDUE'))
        ) AS active_referred,
        COUNT(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM loans WHERE customer_id = ref_c.id)
        ) AS paired_referred
      FROM customers ref_c
      WHERE ref_c.referred_by_id = c.id
    ) ref ON true
    WHERE c.id = $1
    `,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const {
    on_time_count,
    delayed_count,
    default_count,
    total_loans,
    on_time_ratio,
    total_referred,
    active_referred,
    paired_referred,
    paired_percentage,
    ...userProperties
  } = row;

  return {
    ...userProperties,
    credit_history: {
      on_time_count: Number(on_time_count),
      delayed_count: Number(delayed_count),
      default_count: Number(default_count),
      total_loans: Number(total_loans),
      on_time_ratio: Number(on_time_ratio),
    },
    referral_stats: {
      total_referred: Number(total_referred),
      active_referred: Number(active_referred),
      paired_referred: Number(paired_referred),
      paired_percentage: Number(paired_percentage),
    },
  };
}

export async function checkUserExistsByPhoneNumberRepo(
  phoneNumber: string,
): Promise<boolean> {
  const result = await getPool().query(
    `
      SELECT 1 FROM customers
      WHERE phone_number = $1
    `,
    [phoneNumber],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateUserRepo(
  userId: string,
  payload: UpdateUserPayload,
  client: Pool | PoolClient = getPool(),
): Promise<User | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (payload.customer_name !== undefined) {
    values.push(payload.customer_name);
    fields.push(`customer_name = $${values.length}`);
  }
  if (payload.phone_number !== undefined) {
    values.push(payload.phone_number);
    fields.push(`phone_number = $${values.length}`);
  }
  if (payload.preferred_payment_day !== undefined) {
    values.push(payload.preferred_payment_day);
    fields.push(`preferred_payment_day = $${values.length}`);
  }

  if (fields.length === 0) {
    const result = await getPool().query(
      `SELECT * FROM customers WHERE id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  values.push(userId);
  const result = await client.query(
    `
      UPDATE customers SET ${fields.join(", ")}
      WHERE id = $${values.length}::uuid
      RETURNING *
    `,
    values,
  );

  return result.rows[0] ?? null;
}

export async function findLoansByUserIdRepo(
  userId: string,
): Promise<UserLoanRow[] | null> {
  const result = await getPool().query<UserLoanRow>(
    `
      SELECT
        l.id AS loan_id, l.customer_id, l.issued_by_admin_id, l.owning_admin_id, l.nominal_amount, l.upfront_fee, l.disbursed_amount,
        l.total_payable_amount, l.weekly_payable_amount, l.total_months, l.total_weeks,
        l.status, l.issued_at, l.closed_at
      FROM customers u
      LEFT JOIN loans l ON l.customer_id = u.id
      WHERE u.id = $1
      ORDER BY l.issued_at DESC
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows;
}

export async function findReferralsByUserIdRepo(
  userId: string,
  scope: CustomerScope = {},
): Promise<(User | null)[] | null> {
  const result = await getPool().query(
    `
      SELECT r.id, r.customer_name, r.phone_number, r.referred_by_id,
             r.preferred_payment_day, r.preferred_payment_time, r.created_at,
             r.owning_admin_id, r.created_by,
             r.street_name, r.city, r.district
      FROM customers u
      LEFT JOIN customers r
        ON r.referred_by_id = u.id
        AND ($2::uuid IS NULL OR r.owning_admin_id = $2::uuid)
        AND ($3::uuid IS NULL OR r.created_by = $3::uuid)
      WHERE u.id = $1
      ORDER BY r.created_at DESC
    `,
    [userId, scope.owningAdminId ?? null, scope.createdBy ?? null],
  );

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows;
}

export async function listUsersRepo(
  filters: ListUsersFilters,
): Promise<{ rows: User[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(customer_name ILIKE $${values.length} OR phone_number ILIKE $${values.length})`,
    );
  }
  if (filters.owningAdminId) {
    values.push(filters.owningAdminId);
    conditions.push(`owning_admin_id = $${values.length}`);
  }
  if (filters.createdBy) {
    values.push(filters.createdBy);
    conditions.push(`created_by = $${values.length}`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const offset = (filters.page - 1) * filters.limit;
  const listValues = [...values, filters.limit, offset];

  const result = await getPool().query(
    `
      SELECT *, COUNT(*) OVER()::int AS total
      FROM customers
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${listValues.length - 1} OFFSET $${listValues.length}
    `,
    listValues,
  );

  const total = result.rows[0]?.total ?? 0;
  const rows = result.rows.map(({ total: _total, ...row }) => row);
  return { rows, total };
}

export async function getTodayDashboardSummaryRepo(
  owningAdminId: string | null,
  createdBy: string | null,
): Promise<DashboardSummary> {
  const result = await getPool().query(
    `
      SELECT * FROM get_today_dashboard_summary($1::uuid, $2::uuid)
    `,
    [owningAdminId, createdBy],
  );

  const row = result.rows[0];

  return {
    totalTarget: Number(row?.total_target ?? 0),
    totalCollected: Number(row?.total_collected ?? 0),
    remainingAmount: Number(row?.remaining_amount ?? 0),
    totalBorrowers: Number(row?.total_borrowers ?? 0),
    borrowersPending: Number(row?.borrowers_pending ?? 0),
  };
}

export async function findCustomerForUpdateRepo(
  client: PoolClient,
  id: string,
): Promise<Record<string, unknown> | null> {
  const r = await client.query(
    `SELECT * FROM customers WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return r.rows[0] ?? null;
}
