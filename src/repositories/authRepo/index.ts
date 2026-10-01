import { PoolClient } from "pg";
import { getPool } from "../../config/database";
import { AdminUser, CreateAdminPayload } from "../../types/authTypes";

export async function createAdminRepo(
  client: PoolClient,
  payload: CreateAdminPayload,
): Promise<AdminUser> {
  const result = await getPool().query(
    `
      INSERT INTO users (
        user_name, phone_number, email, password_hash, default_upfront_fee_percentage, default_interest_percentage,
        default_total_months, default_total_weeks
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      payload.user_name,
      payload.phone_number,
      payload.email ?? null,
      payload.password_hash,
      payload.default_upfront_fee_percentage,
      payload.default_interest_percentage,
      payload.default_total_months,
      payload.default_total_weeks,
    ],
  );

  return result.rows[0];
}

export async function findAdminByPhoneNumberRepo(
  phone_number: string,
): Promise<AdminUser | null> {
  const result = await getPool().query(
    `
      SELECT * FROM users
      WHERE phone_number = $1
    `,
    [phone_number],
  );

  return result.rows[0] ?? null;
}

export async function findAdminByEmailRepo(
  email: string,
): Promise<AdminUser | null> {
  const result = await getPool().query(
    `
      SELECT * FROM users
      WHERE email = $1
    `,
    [email],
  );

  return result.rows[0] ?? null;
}

export async function findAdminByIdRepo(id: string): Promise<AdminUser | null> { 
  const result = await getPool().query(
    `
      SELECT * FROM users WHERE id = $1
    `, [id]
  );

  return result.rows[0] ?? null;
}
