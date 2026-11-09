import type { Pool, PoolClient } from "pg";
import { getPool } from "../../config/database";
import type {
  AuditEntry,
  AuditListFilters,
  AuditLogRow,
} from "../../types/auditTypes";

type Db = Pool | PoolClient;

const TZ = "Asia/Kolkata";

const NAME = (a: string) =>
  `COALESCE(NULLIF(${a}.user_name, ''), NULLIF(${a}.email, ''), ${a}.phone_number)`;

/** Write one row. Call it inside the same transaction as the change. */
export async function insertAuditLogRepo(db: Db, e: AuditEntry): Promise<void> {
  const json = (v: unknown) =>
    v === undefined || v === null ? null : JSON.stringify(v);
  await db.query(
    `INSERT INTO audit_logs
       (actor_id, target_id, action, entity_type, entity_id, owning_admin_id,
        old_value, new_value, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
    [
      e.actor_id,
      e.target_id ?? null,
      e.action,
      e.entity_type ?? null,
      e.entity_id ?? null,
      e.owning_admin_id ?? null,
      json(e.old_value),
      json(e.new_value),
      json(e.meta),
    ],
  );
}

const SELECT_LOG = `
  l.id, l.created_at, l.action, l.module, l.entity_type, l.entity_id,
  l.actor_id, ${NAME("ac")} AS actor_name, l.actor_role,
  l.target_id, ${NAME("tg")} AS target_name,
  l.owning_admin_id, l.old_value, l.new_value, l.meta`;

const FROM_LOG = `
  FROM audit_logs l
  LEFT JOIN users ac ON ac.id = l.actor_id
  LEFT JOIN users tg ON tg.id = l.target_id`;

export async function listAuditLogsRepo(
  f: AuditListFilters,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const values: unknown[] = [];
  let where = "TRUE";
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where += ` AND ${sql.replace("?", `$${values.length}`)}`;
  };

  if (f.owningAdminId) add("l.owning_admin_id = ?", f.owningAdminId);
  if (f.actions?.length) add("l.action = ANY(?::text[])", f.actions);
  if (f.module) add("l.module = ?", f.module);
  if (f.actorId) add("l.actor_id = ?", f.actorId);
  if (f.targetId) add("l.target_id = ?", f.targetId);
  if (f.entityType) add("l.entity_type = ?", f.entityType);
  if (f.entityId) add("l.entity_id = ?", f.entityId);
  if (f.from)
    add(`l.created_at >= (?::date)::timestamp AT TIME ZONE '${TZ}'`, f.from);
  if (f.to)
    add(`l.created_at < ((?::date) + 1)::timestamp AT TIME ZONE '${TZ}'`, f.to);

  values.push(f.limit, (f.page - 1) * f.limit);
  const r = await getPool().query(
    `SELECT ${SELECT_LOG}, COUNT(*) OVER()::int AS total_count
     ${FROM_LOG}
     WHERE ${where}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const total = (r.rows[0]?.total_count as number | undefined) ?? 0;
  const rows = r.rows.map((row: Record<string, unknown>) => {
    const { total_count: _ignored, ...rest } = row;
    return rest;
  }) as unknown as AuditLogRow[];
  return { rows, total };
}

export async function findAuditLogRepo(
  id: string,
): Promise<AuditLogRow | null> {
  const r = await getPool().query(
    `SELECT ${SELECT_LOG} ${FROM_LOG} WHERE l.id = $1`,
    [id],
  );
  return (r.rows[0] as AuditLogRow) ?? null;
}

/** Actions that exist in the caller's scope, for filter dropdowns. */
export async function listAuditActionsRepo(
  owningAdminId: string | undefined,
  module: string | undefined,
): Promise<
  { action: string; module: string | null; count: number; last_at: string }[]
> {
  const values: unknown[] = [];
  let where = "TRUE";
  if (owningAdminId) {
    values.push(owningAdminId);
    where += ` AND owning_admin_id = $${values.length}`;
  }
  if (module) {
    values.push(module);
    where += ` AND module = $${values.length}`;
  }
  const r = await getPool().query(
    `SELECT action, MAX(module) AS module, COUNT(*)::int AS count,
            MAX(created_at) AS last_at
       FROM audit_logs
      WHERE ${where}
      GROUP BY action
      ORDER BY MAX(module), action`,
    values,
  );
  return r.rows;
}
