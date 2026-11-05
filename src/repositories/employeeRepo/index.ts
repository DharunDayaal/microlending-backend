import type { Pool, PoolClient } from "pg";
import { getPool } from "../../config/database";
import type {
  CreateEmployeePayload,
  EmployeeDetail,
  EmployeeListRow,
  EmployeeRow,
  ListEmployeesFilters,
} from "../../types/employeeTypes";

type Client = Pool | PoolClient;

const STATUS_SQL = {
  pending: "e.is_verified = false AND e.is_active = true",
  active: "e.is_verified = true AND e.is_active = true",
  inactive: "e.is_active = false",
} as const;

const SELECT_EMPLOYEE = `
    e.id, e.user_name, e.phone_number, e.email, e.role, e.is_verified,
    e.is_active, e.admin_id, a.user_name AS admin_name,
    (e.default_upfront_fee_percentage IS NOT NULL) AS has_own_defaults,
    CASE WHEN e.is_active = false THEN 'inactive'
        WHEN e.is_verified = false THEN 'pending'
        ELSE 'active' END AS status,
    e.created_at, e.updated_at
  `;

export async function createEmployeeRepo(
  payload: CreateEmployeePayload,
) {
  const response = await getPool().query(
    `
      INSERT INTO users (
        user_name, phone_number, email, password_hash, role, admin_id,
        is_verified, is_active, default_upfront_fee_percentage,
        default_interest_percentage, default_total_months, default_total_weeks
      )
      VALUES ($1, $2, $3, $4, 'USER', $5, true, true, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      payload.user_name,
      payload.phone_number,
      payload.email ?? null,
      payload.password_hash,
      payload.admin_id,
      payload.default_upfront_fee_percentage,
      payload.default_interest_percentage,
      payload.default_total_months,
      payload.default_total_weeks,
    ],
  );

  return response.rows[0];
}

export async function listEmployeesRepo(
  filters: ListEmployeesFilters,
): Promise<{ rows: EmployeeListRow[]; total: number }> {
  const values: unknown[] = [];
  let where = `e.role = 'USER'`;
  if (filters.adminId) {
    values.push(filters.adminId);
    where += ` AND e.admin_id = $${values.length}`;
  }
  if (filters.status) where += ` AND ${STATUS_SQL[filters.status]}`;
  if (filters.search) {
    values.push(`%${filters.search}%`);
    const n = values.length;
    where += ` AND (e.user_name ILIKE $${n} OR e.phone_number ILIKE $${n} OR e.email ILIKE $${n})`;
  }
  values.push(filters.limit, (filters.page - 1) * filters.limit);

  const response = await getPool().query(
    `
      SELECT ${SELECT_EMPLOYEE},
            (SELECT COUNT(*)::int FROM customers c WHERE c.created_by = e.id)
              AS customers_count,
            COUNT(*) OVER()::int AS total_count
        FROM users e
        LEFT JOIN users a ON a.id = e.admin_id
      WHERE ${where}
      ORDER BY e.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values,
  );
  const total = (response.rows[0]?.total_count as number | undefined) ?? 0;
  const rows = response.rows.map((row: Record<string, unknown>) => {
    const { total_count: _ignored, ...rest } = row;
    return rest;
  }) as unknown as EmployeeListRow[];
  return { rows, total };
}

/** Any account by id, with the same shape as a list row (no counts). */
export async function findEmployeeRepo(
  id: string,
  client: Client = getPool(),
): Promise<(EmployeeRow & { role: string }) | null> {
  const response = await client.query(
    `
      SELECT ${SELECT_EMPLOYEE}
        FROM users e
        LEFT JOIN users a ON a.id = e.admin_id
      WHERE e.id = $1
    `,
    [id],
  );
  return (response.rows[0] as EmployeeRow & { role: string }) ?? null;
}

export async function getEmployeeDetailRepo(
  id: string,
): Promise<EmployeeDetail | null> {
  const response = await getPool().query(
    `
      SELECT ${SELECT_EMPLOYEE},
            (SELECT COUNT(*)::int FROM customers c WHERE c.created_by = e.id)
              AS customers_count,
            (SELECT COUNT(*)::int FROM loans l
               JOIN customers c ON c.id = l.customer_id
              WHERE c.created_by = e.id AND l.status IN ('ACTIVE','OVERDUE'))
              AS active_loans,
            (SELECT COUNT(*)::int FROM loans l
               JOIN customers c ON c.id = l.customer_id
              WHERE c.created_by = e.id AND l.status = 'OVERDUE')
              AS overdue_loans
        FROM users e
        LEFT JOIN users a ON a.id = e.admin_id
      WHERE e.id = $1 AND e.role = 'USER'
    `,
    [id],
  );
  return (response.rows[0] as EmployeeDetail) ?? null;
}

export async function setEmployeeFlagRepo(
  client: Client,
  id: string,
  flag: "is_verified" | "is_active",
  value: boolean,
): Promise<void> {
  if (flag !== "is_verified" && flag !== "is_active") {
    throw new Error("Invalid flag");
  }
  await client.query(
    `
      UPDATE users SET ${flag} = $1, updated_at = now()
      WHERE id = $2 AND role = 'USER'
    `,
    [value, id],
  );
}
