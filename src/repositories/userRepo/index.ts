import { getPool } from "../../config/database";
import { CreateUserSchema } from "../../schemas/userSchema";
import { Loan } from "../../types/loanTypes";
import {
  GetUsersOnWeekdayPayload,
  ListUsersFilters,
  UpdateUserPayload,
  User,
  UserLoanRow,
  Week,
} from "../../types/userTypes";

export async function createUserRepo(
  payload: CreateUserSchema,
  createdBy: string,
): Promise<User> {
  const result = await getPool().query(
    `
      INSERT INTO customers (customer_name, phone_number, referred_by_id, preferred_payment_day, created_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      payload.customer_name,
      payload.phone_number,
      payload.referred_by_id,
      payload.preferred_payment_day,
      payload.created_at,
      createdBy,
    ],
  );

  return result.rows[0];
}

export async function getUsersOnWeekdayRepo(
  payload: GetUsersOnWeekdayPayload,
): Promise<User[]> {
  let whereClause = `WHERE preferred_payment_day = $1`;
  const values: unknown[] = [
    payload.weekday,
    payload.limit,
    payload.startIndex,
  ];

  if (payload.search) {
    whereClause += ` AND customer_name ILIKE $4`;
    values.push(`%${payload.search}%`);
  }
  const result = await getPool().query(
    `
      SELECT id, customer_name, phone_number, referred_by_id, preferred_payment_day, created_at
      FROM customers
      ${whereClause}
      LIMIT $2 OFFSET $3
    `,
    values,
  );

  return result.rows;
}

export async function getUserByIdRepo(userId: string): Promise<User | null> {
  const result = await getPool().query(
    `
      SELECT * FROM customers
      WHERE id = $1
    `,
    [userId],
  );
  return result.rows[0] ?? null;
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
    return getUserByIdRepo(userId);
  }

  values.push(userId);
  const result = await getPool().query(
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
  const result = await getPool().query(
    `
      SELECT
        l.id AS loan_id, l.customer_id, l.issued_by_admin_id, l.nominal_amount, l.upfront_fee, l.disbursed_amount,
        l.total_payable_amount, l.weekly_payable_amount, l.total_months, l.total_weeks,
        l.status, l.issued_at
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
): Promise<(User | null)[] | null> {
  const result = await getPool().query(
    `
      SELECT r.id, r.customer_name, r.phone_number, r.referred_by_id, r.preferred_payment_day, r.created_at
      FROM customers u
      LEFT JOIN customers r ON r.referred_by_id = u.id
      WHERE u.id = $1
      ORDER BY r.created_at DESC
    `,
    [userId],
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
