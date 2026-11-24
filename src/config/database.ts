import { Pool, PoolClient, PoolConfig } from "pg";
import { DATABASE_URL } from "./env";
import { logger } from "../shared/logger";

let pool: Pool | null = null;

const IS_SERVERLESS = process.env.VERCEL === "1";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function buildPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: "micro-lending-api",

    // Each serverless instance gets its own pool, and Supavisor (port 6543)
    // multiplexes them, so keep per-instance pools small there.
    max: intFromEnv("DB_POOL_MAX", IS_SERVERLESS ? 10 : 20),
    min: 0,

    // Close idle clients quickly. On Vercel a frozen lambda's sockets are
    // silently dropped by the pooler/NAT; reusing them causes requests to hang.
    idleTimeoutMillis: intFromEnv(
      "DB_IDLE_TIMEOUT_MS",
      IS_SERVERLESS ? 10_000 : 30_000,
    ),

    // Fail fast instead of waiting forever for a connection (default is 0 = never).
    connectionTimeoutMillis: intFromEnv("DB_CONNECTION_TIMEOUT_MS", 10_000),

    // Recycle connections periodically so stale or half-open sockets don't pile up.
    maxLifetimeSeconds: intFromEnv("DB_MAX_LIFETIME_SECONDS", 300),

    // Client-side cap on a single query so a stuck query can't hold a request open.
    query_timeout: intFromEnv("DB_QUERY_TIMEOUT_MS", 30_000),

    // Detect dead peers on long-lived sockets.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,

    // Let the process/lambda exit when every client is idle.
    allowExitOnIdle: IS_SERVERLESS,
  };
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }

    pool = new Pool(buildPoolConfig(connectionString));

    // An idle client errored (e.g. the server/pooler dropped the socket).
    // pg-pool already removes it from the pool; just log it.
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
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection is likely broken; make sure it isn't returned to the pool.
      releaseError = rollbackError as Error;
      logger.error({ err: rollbackError }, "Transaction rollback failed");
    }
    throw error;
  } finally {
    // Passing an error destroys the client instead of returning it to the pool.
    client.release(releaseError);
  }
}
