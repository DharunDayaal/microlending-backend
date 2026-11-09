import type { Pool, PoolClient } from "pg";
import { AppError } from "../../helpers";
import * as Repo from "../../repositories/auditRepo";
import type { RequestingUser } from "../../types/authTypes";
import type {
  AuditEntry,
  AuditLogItem,
  AuditLogRow,
} from "../../types/auditTypes";
import type {
  ActionsQuerySchema,
  ListAuditLogsQuerySchema,
} from "../../schemas/auditSchema";

type Db = Pool | PoolClient;

// Writing (used by every other service)
const SECRET_KEY = /pass(word)?|hash|otp|token|secret|pin\b|authorization/i;

/** Drops secrets so they can never reach the audit table, however deep. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

function stable(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export const sameValue = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * Compare two objects over `keys` and return only what changed, or null when
 * nothing did (so callers can skip logging a no-op).
 *   const change = changedValues(before, after, ["user_name", "email"]);
 *   if (change) await recordAudit(client, { ..., ...change });
 */
export function changedValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): {
  old_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
} | null {
  const old_value: Record<string, unknown> = {};
  const new_value: Record<string, unknown> = {};
  for (const k of keys) {
    if (!sameValue(before[k], after[k])) {
      old_value[k] = before[k] ?? null;
      new_value[k] = after[k] ?? null;
    }
  }
  return Object.keys(new_value).length ? { old_value, new_value } : null;
}

/** ip / user agent / request id for `meta`. Call it in the controller and pass it down. */
export function auditContext(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): Record<string, unknown> {
  const ua = req.headers["user-agent"];
  const rid = req.headers["x-request-id"];
  return {
    ip: req.ip ?? null,
    user_agent: Array.isArray(ua) ? ua[0] : (ua ?? null),
    request_id: Array.isArray(rid) ? rid[0] : (rid ?? null),
  };
}

/**
 * Write one audit row. Pass the transaction client so the log commits or rolls
 * back together with the change. Returns false when it skipped a no-op.
 */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<boolean> {
  if (
    entry.old_value !== undefined &&
    entry.new_value !== undefined &&
    sameValue(entry.old_value, entry.new_value)
  ) {
    return false;
  }
  await Repo.insertAuditLogRepo(db, {
    ...entry,
    old_value: scrub(entry.old_value),
    new_value: scrub(entry.new_value),
    meta: entry.meta
      ? (scrub(entry.meta) as Record<string, unknown>)
      : undefined,
  });
  return true;
}

/**
 * Fire-and-forget version for events that have no transaction to join
 * (failed logins, exports). Never awaited, never throws: a logging failure
 * must not break the request. Do NOT use it for data changes.
 */
export function recordAuditSafe(db: Db, entry: AuditEntry): void {
  recordAudit(db, entry).catch((err) => {
    console.error("[audit] could not record", entry.action, err);
  });
}

/**
 * For jobs and other work done by the system itself (nightly overdue job...).
 * Stored with actor_id NULL and meta.actor_type = "SYSTEM", so the list shows
 * the actor as "System" and meta.source names the job.
 */
export function recordSystemAudit(
  db: Db,
  job: string,
  entry: Omit<AuditEntry, "actor_id">,
): Promise<boolean> {
  return recordAudit(db, {
    ...entry,
    actor_id: null,
    meta: { ...entry.meta, actor_type: "SYSTEM", source: job },
  });
}

/**
 * SUPER_ADMIN -> everything (optionally one team via admin_id)
 * ADMIN       -> their team's rows only
 * USER        -> no access
 */
function scopeFor(user: RequestingUser, adminId?: string): string | undefined {
  if (user.role === "USER") {
    throw new AppError(403, "You don't have permission to view audit logs");
  }
  return user.role === "ADMIN" ? user.teamId : adminId;
}

function changedFields(
  oldV: Record<string, unknown> | null,
  newV: Record<string, unknown> | null,
): string[] {
  const keys = new Set([
    ...Object.keys(oldV ?? {}),
    ...Object.keys(newV ?? {}),
  ]);
  return [...keys].filter((k) => !sameValue(oldV?.[k], newV?.[k]));
}

function toItem(r: AuditLogRow): AuditLogItem {
  const { actor_id, actor_name, actor_role, target_id, target_name, ...rest } =
    r;
  return {
    ...rest,
    actor: actor_id
      ? { id: actor_id, name: actor_name, role: actor_role }
      : r.meta?.actor_type === "SYSTEM"
        ? { id: null, name: "System", role: "SYSTEM" }
        : null,
    target: target_id ? { id: target_id, name: target_name } : null,
    changed_fields: changedFields(r.old_value, r.new_value),
  };
}

export async function listAuditLogs(
  user: RequestingUser,
  q: ListAuditLogsQuerySchema,
) {
  const owningAdminId = scopeFor(user, q.admin_id);
  const { rows, total } = await Repo.listAuditLogsRepo({
    owningAdminId,
    actions: q.action,
    module: q.module,
    actorId: q.actor_id,
    targetId: q.target_id,
    entityType: q.entity_type,
    entityId: q.entity_id,
    from: q.from,
    to: q.to,
    page: q.page,
    limit: q.limit,
  });
  return { rows: rows.map(toItem), total };
}

export async function getAuditLog(user: RequestingUser, id: string) {
  const owningAdminId = scopeFor(user);
  const row = await Repo.findAuditLogRepo(id);
  // out of scope looks the same as missing
  if (!row || (owningAdminId && row.owning_admin_id !== owningAdminId)) {
    throw new AppError(404, "Audit log not found");
  }
  return toItem(row);
}

export async function listAuditActions(
  user: RequestingUser,
  q: ActionsQuerySchema,
) {
  const owningAdminId = scopeFor(user, q.admin_id);
  return Repo.listAuditActionsRepo(owningAdminId, q.module);
}
