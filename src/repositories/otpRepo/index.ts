import { Pool, PoolClient } from "pg";
import { OtpCode, OtpPurpose } from "../../types/authTypes";
import { getPool } from "../../config/database";

type Queryable = Pool | PoolClient;

export async function createOtpRepo(
  phone_number: string,
  otp: string,
  purpose: OtpPurpose,
  expiresAt: Date,
): Promise<OtpCode> {
  const result = await getPool().query(
    `
      INSERT INTO otp_codes (phone_number, otp_hash, purpose, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [phone_number, otp, purpose, expiresAt],
  );

  return result.rows[0];
}

export async function findLatestOtpRepo(
  phone_number: string,
  purpose: OtpPurpose,
): Promise<OtpCode | null> {
  const result = await getPool().query(
    `
      SELECT * FROM otp_codes
      WHERE phone_number = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [phone_number, purpose],
  );

  return result.rows[0] ?? null;
}

export async function incrementOtpAttemptsRepo(client: Queryable, otpId: string): Promise<void> {
  console.log("Incrementing OTP attempts for OTP ID:", otpId);
 const result = await client.query(
    `
      UPDATE otp_codes
      SET attempts = attempts + 1
      WHERE id = $1
      RETURNING id, attempts
    `,
    [otpId],
  );

  console.log("Updated OTP:", result.rows[0]);
}

export async function markOtpVerification(client: Queryable, otpId: string): Promise<void> {
  await client.query(
    `
      UPDATE otp_codes SET verified_at = now() WHERE id = $1
    `,
    [otpId],
  );
}

// Locks the OTP row for update to prevent race conditions
export async function findVerifiedUncosumedOtpForUpdateRepo(
  client: Queryable,
  phone_number: string,
  purpose: OtpPurpose,
  valid_since: Date,
): Promise<OtpCode | null> {
  const result = await client.query(
    `
      SELECT * FROM otp_codes
      WHERE phone_number = $1
        AND purpose = $2
        AND verified_at IS NOT NULL
        AND verified_at >= $3
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [phone_number, purpose, valid_since],
  );

  return result.rows[0] ?? null;
}

export async function findOtpForLoginForUpdateRepo(
  client: PoolClient,
  phone_number: string,
  purpose: OtpPurpose,
): Promise<OtpCode | null> {
  const result = await client.query(
    `
      SELECT * FROM otp_codes
      WHERE phone_number = $1
        AND purpose = $2
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [phone_number, purpose],
  );

  return result.rows[0] ?? null;
}

export async function markOtpConsumedRepo(
  client: PoolClient,
  otpId: string,
): Promise<void> {
  await client.query(
    `
      UPDATE otp_codes SET consumed_at = now() WHERE id = $1
    `,
    [otpId],
  );
}
