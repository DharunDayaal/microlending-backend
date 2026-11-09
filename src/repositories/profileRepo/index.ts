import type { Pool, PoolClient } from "pg";
import { getPool } from "../../config/database";

type Client = Pool | PoolClient;

export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";

const PUBLIC_COLS = `
  id, user_name, phone_number, email, role, is_verified, is_active,
  default_upfront_fee_percentage, default_interest_percentage,
  default_total_months, default_total_weeks,
  admin_id, created_at, updated_at`;

export interface UserRow {
  id: string;
  user_name: string;
  phone_number: string;
  email: string | null;
  role: Role;
  is_verified: boolean;
  is_active: boolean;
  default_upfront_fee_percentage: number | null;
  default_interest_percentage: number | null;
  default_total_months: number | null;
  default_total_weeks: number | null;
  admin_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Limits {
  min_principal: number;
  max_principal: number;
  min_months: number;
  max_months: number;
  max_fee_percent: number;
  max_interest_percent: number;
}

export const DEFAULT_LIMITS: Limits = {
  min_principal: 500,
  max_principal: 1_000_000,
  min_months: 0.5,
  max_months: 12,
  max_fee_percent: 20,
  max_interest_percent: 100,
};

export async function findUserRepo(
  id: string,
  client: Client = getPool(),
): Promise<UserRow | null> {
  const response = await client.query(
    `
      SELECT ${PUBLIC_COLS} FROM users WHERE id = $1
    `,
    [id],
  );
  return (response.rows[0] as UserRow) ?? null;
}

export async function findPasswordHashRepo(
  id: string,
  client: Client,
): Promise<string | null> {
  const response = await client.query(
    `SELECT password_hash FROM users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return response.rows[0]?.password_hash ?? null;
}

export async function updateProfileRepo(
  client: Client,
  id: string,
  fields: { user_name?: string; email?: string },
): Promise<UserRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.user_name !== undefined) {
    values.push(fields.user_name);
    sets.push(`user_name = $${values.length}`);
  }
  if (fields.email !== undefined) {
    values.push(fields.email);
    sets.push(`email = $${values.length}`);
  }
  values.push(id);
  const response = await client.query(
    `UPDATE users SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $${values.length} RETURNING ${PUBLIC_COLS}`,
    values,
  );
  return response.rows[0] as UserRow;
}

export async function updatePhoneRepo(
  client: Client,
  id: string,
  phone: string,
): Promise<UserRow> {
  const response = await client.query(
    `UPDATE users SET phone_number = $1, updated_at = now()
     WHERE id = $2 RETURNING ${PUBLIC_COLS}`,
    [phone, id],
  );
  return response.rows[0] as UserRow;
}

export async function updatePasswordHashRepo(
  client: Client,
  id: string,
  hash: string,
): Promise<void> {
  await client.query(
    `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
    [hash, id],
  );
}

export async function updateDefaultsRepo(
  client: Client,
  id: string,
  d: { fee: number; interest: number; months: number; weeks: number },
): Promise<UserRow> {
  const response = await client.query(
    `UPDATE users
        SET default_upfront_fee_percentage = $1,
            default_interest_percentage = $2,
            default_total_months = $3,
            default_total_weeks = $4,
            updated_at = now()
      WHERE id = $5 RETURNING ${PUBLIC_COLS}`,
    [d.fee, d.interest, d.months, d.weeks, id],
  );
  return response.rows[0] as UserRow;
}

export interface SessionRow {
  id: string;
  created_at: string;
  expires_at: string;
}

export async function listSessionsRepo(userId: string): Promise<SessionRow[]> {
  const response = await getPool().query(
    `SELECT id, created_at, expires_at
       FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [userId],
  );
  return response.rows as SessionRow[];
}

export async function revokeSessionRepo(
  client: Client,
  userId: string,
  sessionId: string,
): Promise<number> {
  const response = await client.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId],
  );
  return response.rowCount ?? 0;
}

/** Revokes every live token of the user, optionally keeping one (by hash). */
export async function revokeSessionsRepo(
  client: Client,
  userId: string,
  keepTokenHash: string | null = null,
): Promise<number> {
  const response = await client.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        AND ($2::text IS NULL OR token_hash <> $2)`,
    [userId, keepTokenHash],
  );
  return response.rowCount ?? 0;
}

export interface MemberRow {
  id: string;
  user_name: string;
  phone_number: string;
  role: Role;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  customers_count: number;
}

export async function listMembersRepo(adminId: string): Promise<MemberRow[]> {
  const response = await getPool().query(
    `SELECT u.id, u.user_name, u.phone_number, u.role, u.is_active,
            u.is_verified, u.created_at,
            (SELECT COUNT(*)::int FROM customers c WHERE c.created_by = u.id)
              AS customers_count
       FROM users u
      WHERE u.admin_id = $1
      ORDER BY u.user_name`,
    [adminId],
  );
  return response.rows as MemberRow[];
}

export interface TeamRow {
  admin_id: string;
  user_name: string;
  is_active: boolean;
  is_verified: boolean;
  members_count: number;
  pending_count: number;
}

export async function listTeamsRepo(): Promise<TeamRow[]> {
  const response = await getPool().query(
    `SELECT a.id AS admin_id, a.user_name, a.is_active, a.is_verified,
            COUNT(m.id)::int AS members_count,
            COUNT(m.id) FILTER (WHERE m.is_verified = false)::int AS pending_count
       FROM users a
       LEFT JOIN users m ON m.admin_id = a.id
      WHERE a.role = 'ADMIN' AND a.is_verified = true
      GROUP BY a.id
      ORDER BY a.user_name`,
  );
  return response.rows as TeamRow[];
}

export async function countPendingAdminsRepo(): Promise<number> {
  const response = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM users
      WHERE role = 'ADMIN' AND is_verified = false AND is_active = true`,
  );
  return response.rows[0].n as number;
}

export type AdminStatus = "pending" | "active" | "inactive";

export interface AdminListRow extends Omit<UserRow, never> {
  members_count: number;
  status: AdminStatus;
}

const STATUS_SQL: Record<AdminStatus, string> = {
  pending: "a.is_verified = false AND a.is_active = true",
  active: "a.is_verified = true AND a.is_active = true",
  inactive: "a.is_active = false",
};

export async function listAdminsRepo(
  status: AdminStatus | undefined,
  search: string | undefined,
  page: number,
  limit: number,
): Promise<{ rows: AdminListRow[]; total: number }> {
  const values: unknown[] = [];
  let where = `a.role = 'ADMIN'`;
  if (status) where += ` AND ${STATUS_SQL[status]}`;
  if (search) {
    values.push(`%${search}%`);
    const n = values.length;
    where += ` AND (a.user_name ILIKE $${n} OR a.phone_number ILIKE $${n} OR a.email ILIKE $${n})`;
  }
  values.push(limit, (page - 1) * limit);
  const response = await getPool().query(
    `SELECT a.id, a.user_name, a.phone_number, a.email, a.role, a.is_verified,
            a.is_active, a.default_upfront_fee_percentage,
            a.default_interest_percentage, a.default_total_months,
            a.default_total_weeks, a.admin_id, a.created_at, a.updated_at,
            (SELECT COUNT(*)::int FROM users m WHERE m.admin_id = a.id) AS members_count,
            CASE WHEN a.is_active = false THEN 'inactive'
                 WHEN a.is_verified = false THEN 'pending'
                 ELSE 'active' END AS status,
            COUNT(*) OVER()::int AS total_count
       FROM users a
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const total = response.rows[0]?.total_count ?? 0;
  const rows = response.rows.map(
    ({ total_count, ...rest }) => rest,
  ) as AdminListRow[];
  return { rows, total };
}

export async function setAdminFlagRepo(
  client: Client,
  id: string,
  flag: "is_verified" | "is_active",
  value: boolean,
): Promise<UserRow> {
  if (flag !== "is_verified" && flag !== "is_active") {
    throw new Error("Invalid flag");
  }
  const response = await client.query(
    `UPDATE users SET ${flag} = $1, updated_at = now()
      WHERE id = $2 RETURNING ${PUBLIC_COLS}`,
    [value, id],
  );
  return response.rows[0] as UserRow;
}

export async function getLimitsRepo(
  client: Client = getPool(),
): Promise<Limits> {
  const response = await client.query(
    `SELECT value FROM app_settings WHERE key = 'loan_limits'`,
  );
  return {
    ...DEFAULT_LIMITS,
    ...((response.rows[0]?.value as Partial<Limits>) ?? {}),
  };
}

export async function upsertLimitsRepo(
  client: Client,
  limits: Limits,
  userId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('loan_limits', $1::jsonb, $2, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [JSON.stringify(limits), userId],
  );
}

export async function insertAuditRepo(
  client: Client,
  entry: {
    actor_id: string;
    target_id: string | null;
    action: string;
    old_value?: unknown;
    new_value?: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_id, target_id, action, old_value, new_value)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      entry.actor_id,
      entry.target_id,
      entry.action,
      entry.old_value === undefined ? null : JSON.stringify(entry.old_value),
      entry.new_value === undefined ? null : JSON.stringify(entry.new_value),
    ],
  );
}

// customers who paid in a range, same scope rules as analytics
export async function countCustomersPaidRepo(
  scope: { owningAdminId?: string; createclienty?: string },
  from: string,
  to: string,
): Promise<number> {
  const values: unknown[] = [from, to];
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND l.owning_admin_id = $${values.length}`;
  }
  if (scope.createclienty) {
    values.push(scope.createclienty);
    clause += ` AND c.created_by = $${values.length}`;
  }
  const response = await getPool().query(
    `SELECT COUNT(DISTINCT l.customer_id)::int AS n
       FROM payments p
       JOIN loans l ON l.id = p.loan_id
       JOIN customers c ON c.id = l.customer_id
      WHERE (p.paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        ${clause}`,
    values,
  );
  return response.rows[0].n as number;
}
