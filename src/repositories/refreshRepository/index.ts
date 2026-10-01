import { getPool } from "../../config/database";
import { Pool, PoolClient } from "pg";
import { RefreshToken } from "../../types/authTypes";

type Queryable = Pool | PoolClient;

export async function storeRefreshTokenRepo(
  client: Queryable,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await client.query(
    `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expiresAt],
  );
}

export async function revokeRefreshTokenRepo(
  client: Queryable,
  tokenId: string,
): Promise<void> {
  await client.query(
    `
      UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1
    `,
    [tokenId],
  );
}

export async function revokeAllRefreshTokensForUserRepo(
  client: Queryable,
  userId: string,
): Promise<void> {
  await client.query(
    `
      UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL
    `,
    [userId],
  );
}

export async function findRefreshTokenByHashForUpdateRepo(
  client: Queryable,
  tokenHash: string,
): Promise<RefreshToken | null> {
  const result = await client.query(
    `
      SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE
    `,
    [tokenHash],
  );

  return result.rows[0] ?? null;
}

export async function findRefreshTokenByHashRepo(tokenHash: string): Promise<RefreshToken | null> {
  const result = await getPool().query(
    `
      SELECT * FROM refresh_tokens WHERE token_hash = $1
    `,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}