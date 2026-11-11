// The `exports` table is the job queue: one row per requested file.
import type { Pool, PoolClient } from "pg";
import { getPool } from "../../config/database";
import {
  EXPORT_FILE_TTL_HOURS,
  EXPORT_MAX_ATTEMPTS,
  EXPORT_STALE_MINUTES,
} from "../../types/exportTypes";
import type {
  ExportFormat,
  ExportRole,
  ExportRow,
  ExportScope,
  ExportType,
} from "../../types/exportTypes";

type Db = Pool | PoolClient;

const COLS = `
  id, type, format, status, params, params_hash, scope, requested_by,
  owning_admin_id, requester_role, total_rows, processed_rows, file_path,
  file_name, file_size::float8 AS file_size, attempts, error, heartbeat_at,
  created_at, started_at, finished_at, expires_at`;

// ---- request side -----------------------------------------------------------

/** One request at a time per user, so the dedupe and the active-count checks cannot race. */
export async function lockUserExportsRepo(
  db: Db,
  userId: string,
): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `export:${userId}`,
  ]);
}

export async function findActiveByHashRepo(
  db: Db,
  userId: string,
  hash: string,
): Promise<ExportRow | null> {
  const r = await db.query(
    `SELECT ${COLS} FROM exports
      WHERE requested_by = $1 AND params_hash = $2 AND status IN ('QUEUED','RUNNING')`,
    [userId, hash],
  );
  return (r.rows[0] as ExportRow) ?? null;
}

export async function countActiveExportsRepo(
  db: Db,
  userId: string,
): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM exports
      WHERE requested_by = $1 AND status IN ('QUEUED','RUNNING')`,
    [userId],
  );
  return r.rows[0].n as number;
}

export interface NewExport {
  type: ExportType;
  format: ExportFormat;
  params: unknown;
  params_hash: string;
  scope: ExportScope;
  requested_by: string;
  owning_admin_id: string | null;
  requester_role: ExportRole;
  total_rows: number;
}

export async function insertExportRepo(
  db: Db,
  e: NewExport,
): Promise<ExportRow> {
  const r = await db.query(
    `INSERT INTO exports
       (type, format, params, params_hash, scope, requested_by, owning_admin_id,
        requester_role, total_rows)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, $9)
     RETURNING ${COLS}`,
    [
      e.type,
      e.format,
      JSON.stringify(e.params),
      e.params_hash,
      JSON.stringify(e.scope),
      e.requested_by,
      e.owning_admin_id,
      e.requester_role,
      e.total_rows,
    ],
  );
  return r.rows[0] as ExportRow;
}

export async function findExportRepo(id: string): Promise<ExportRow | null> {
  const r = await getPool().query(`SELECT ${COLS} FROM exports WHERE id = $1`, [
    id,
  ]);
  return (r.rows[0] as ExportRow) ?? null;
}

export async function listExportsRepo(
  userId: string,
  limit: number,
): Promise<ExportRow[]> {
  const r = await getPool().query(
    `SELECT ${COLS} FROM exports WHERE requested_by = $1
      ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows as ExportRow[];
}

// ---- worker side ------------------------------------------------------------

/**
 * Takes the oldest waiting job (or one whose worker went quiet) and marks it
 * RUNNING. SKIP LOCKED means two workers never take the same job.
 */
export async function claimNextExportRepo(): Promise<ExportRow | null> {
  // a job that went quiet after its last allowed attempt is finished for good
  await getPool().query(
    `UPDATE exports
        SET status = 'FAILED', finished_at = now(),
            error = 'The export did not finish. Please try again.'
      WHERE status = 'RUNNING'
        AND heartbeat_at < now() - make_interval(mins => $1)
        AND attempts >= $2`,
    [EXPORT_STALE_MINUTES, EXPORT_MAX_ATTEMPTS],
  );

  const r = await getPool().query(
    `UPDATE exports
        SET status = 'RUNNING', attempts = attempts + 1, started_at = now(),
            heartbeat_at = now(), processed_rows = 0, error = NULL
      WHERE id = (
        SELECT id FROM exports
         WHERE (status = 'QUEUED'
                OR (status = 'RUNNING'
                    AND heartbeat_at < now() - make_interval(mins => $1)))
           AND attempts < $2
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING ${COLS}`,
    [EXPORT_STALE_MINUTES, EXPORT_MAX_ATTEMPTS],
  );
  return (r.rows[0] as ExportRow) ?? null;
}

/** false = this worker no longer owns the job (it was taken over), so it must stop. */
export async function heartbeatExportRepo(
  id: string,
  processed: number,
): Promise<boolean> {
  const r = await getPool().query(
    `UPDATE exports SET processed_rows = $2, heartbeat_at = now()
      WHERE id = $1 AND status = 'RUNNING'`,
    [id, processed],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function setExportTotalRepo(
  id: string,
  total: number,
): Promise<void> {
  await getPool().query(
    `UPDATE exports SET total_rows = $2 WHERE id = $1 AND status = 'RUNNING'`,
    [id, total],
  );
}

export async function markExportDoneRepo(
  db: Db,
  id: string,
  f: { filePath: string; fileName: string; size: number; rows: number },
): Promise<boolean> {
  const r = await db.query(
    `UPDATE exports
        SET status = 'DONE', file_path = $2, file_name = $3, file_size = $4,
            total_rows = $5, processed_rows = $5, error = NULL,
            finished_at = now(),
            expires_at = now() + make_interval(hours => $6),
            heartbeat_at = now()
      WHERE id = $1 AND status = 'RUNNING'`,
    [id, f.filePath, f.fileName, f.size, f.rows, EXPORT_FILE_TTL_HOURS],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Puts the job back in the queue, or fails it when attempts are used up or `final` is set. */
export async function failOrRequeueExportRepo(
  id: string,
  message: string,
  final: boolean,
): Promise<"QUEUED" | "FAILED" | null> {
  const r = await getPool().query(
    `UPDATE exports
        SET status = CASE WHEN $3::boolean OR attempts >= $4 THEN 'FAILED' ELSE 'QUEUED' END,
            error = $2,
            heartbeat_at = NULL,
            finished_at = CASE WHEN $3::boolean OR attempts >= $4 THEN now() ELSE NULL END
      WHERE id = $1 AND status = 'RUNNING'
      RETURNING status`,
    [id, message, final, EXPORT_MAX_ATTEMPTS],
  );
  return (r.rows[0]?.status as "QUEUED" | "FAILED") ?? null;
}

// ---- cleanup ----------------------------------------------------------------

export async function findExpiredExportsRepo(
  limit: number,
): Promise<{ id: string; file_path: string }[]> {
  const r = await getPool().query(
    `SELECT id, file_path FROM exports
      WHERE status = 'DONE' AND expires_at < now() AND file_path IS NOT NULL
      ORDER BY expires_at LIMIT $1`,
    [limit],
  );
  return r.rows as { id: string; file_path: string }[];
}

export async function markExportsExpiredRepo(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getPool().query(
    `UPDATE exports SET status = 'EXPIRED', file_path = NULL
      WHERE id = ANY($1::uuid[]) AND status = 'DONE'`,
    [ids],
  );
}

export async function purgeOldExportsRepo(days: number): Promise<number> {
  const r = await getPool().query(
    `DELETE FROM exports
      WHERE status IN ('EXPIRED','FAILED')
        AND created_at < now() - make_interval(days => $1)`,
    [days],
  );
  return r.rowCount ?? 0;
}
