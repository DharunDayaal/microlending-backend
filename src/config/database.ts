import { Pool, PoolClient } from "pg";
import { DATABASE_URL } from "./env";
import { logger } from "../helpers";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      keepAlive: true,
      idleTimeoutMillis: 0,
    });

    // Incase of an error on the pool, log it.
    pool.on("error", (err) => {
      logger.error({ err }, "Unexpected error on idle database client");
    });
  }

  return pool;
}

export async function warmPool(): Promise<void> {
  const start = performance.now();
  await getPool().query("SELECT 1");
  logger.info(
    `Database pool warmed in ${Math.round(performance.now() - start)}ms`,
  );
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
