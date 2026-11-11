// place at: src/services/exportService.ts
import { createHash } from "node:crypto";
import { withTransaction } from "../../config/database";
import { EXPORT_MAX_CSV_ROWS, EXPORT_MAX_XLSX_ROWS } from "../../config/env";
import { AppError } from "../../helpers";
import * as Repo from "../../repositories/exportRepo";
import { EXPORTS } from "../../repositories/exportRepo/exportQueries";
import { resolveScope } from "../../services/analyticsService";
import { signExportUrl } from "./exportStorage";
import type { RequestingUser } from "../../types/authTypes";
import {
  EXPORT_MAX_ACTIVE_PER_USER,
  EXPORT_URL_TTL_SECONDS,
} from "../../types/exportTypes";
import type {
  ExportFilters,
  ExportFormat,
  ExportItem,
  ExportRow,
} from "../../types/exportTypes";
import type { CreateExportSchema } from "../../schemas/exportSchema";

/** Largest file we will build in one go. Raise only after timing a real run. */
export const maxRowsFor = (format: ExportFormat): number =>
  Number(format === "xlsx" ? EXPORT_MAX_XLSX_ROWS : EXPORT_MAX_CSV_ROWS);

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

function toItem(row: ExportRow, url?: string): ExportItem {
  const expired =
    row.status === "DONE" && !!row.expires_at && Date.parse(row.expires_at) < Date.now();
  const status = expired ? "EXPIRED" : row.status;
  const total = row.total_rows;
  return {
    id: row.id,
    type: row.type,
    format: row.format,
    status,
    filters: row.params?.filters ?? {},
    total_rows: total,
    processed_rows: row.processed_rows,
    progress:
      status === "DONE"
        ? 1
        : total && total > 0
          ? Math.min(1, row.processed_rows / total)
          : total === 0
            ? 0
            : null,
    file_name: status === "DONE" ? row.file_name : null,
    file_size: status === "DONE" ? row.file_size : null,
    error: row.error,
    created_at: row.created_at,
    finished_at: row.finished_at,
    expires_at: row.expires_at,
    ...(url ? { download_url: url, download_expires_in: EXPORT_URL_TTL_SECONDS } : {}),
  };
}

/**
 * Queue an export. Returns straight away; the worker builds the file.
 * Asking for the same export again while one is active returns that job.
 */
export async function requestExport(user: RequestingUser, body: CreateExportSchema) {
  const def = EXPORTS[body.type];
  if (!def.roles.includes(user.role)) {
    throw new AppError(403, "You don't have permission to download this report");
  }

  const filters = body.filters as ExportFilters;
  // who can see what is decided here, once, and stored with the job
  const scope = resolveScope(user, {
    admin_id: filters.admin_id,
    employee_id: filters.employee_id,
  });

  const total = await def.count(scope, filters);
  const cap = maxRowsFor(body.format);
  if (total > cap) {
    throw new AppError(
      400,
      body.format === "xlsx" && total <= Number(EXPORT_MAX_CSV_ROWS)
        ? `This export has ${total} rows, too many for Excel (limit ${cap}). Choose CSV or narrow the dates.`
        : `This export has ${total} rows, over the limit of ${cap}. Narrow the filters.`,
    );
  }

  const params = { type: body.type, format: body.format, filters };
  const hash = createHash("sha256").update(stable(params)).digest("hex");

  const { row, existing } = await withTransaction(async (client) => {
    await Repo.lockUserExportsRepo(client, user.id);

    const active = await Repo.findActiveByHashRepo(client, user.id, hash);
    if (active) return { row: active, existing: true };

    if ((await Repo.countActiveExportsRepo(client, user.id)) >= EXPORT_MAX_ACTIVE_PER_USER) {
      throw new AppError(
        429,
        "You already have downloads in progress. Wait for one to finish and try again.",
      );
    }

    const created = await Repo.insertExportRepo(client, {
      type: body.type,
      format: body.format,
      params,
      params_hash: hash,
      scope,
      requested_by: user.id,
      owning_admin_id: scope.owningAdminId ?? null,
      requester_role: user.role,
      total_rows: total,
    });
    return { row: created, existing: false };
  });

  return { export: toItem(row), already_running: existing };
}

/** Status, progress, and a fresh download link once the file is ready. */
export async function getExport(user: RequestingUser, id: string) {
  const row = await Repo.findExportRepo(id);
  // other people's exports look the same as missing ones
  if (!row || row.requested_by !== user.id) {
    throw new AppError(404, "Export not found");
  }
  const item = toItem(row);
  if (item.status === "DONE" && row.file_path && row.file_name) {
    const url = await signExportUrl(row.file_path, row.file_name, EXPORT_URL_TTL_SECONDS);
    return toItem(row, url);
  }
  return item;
}

export async function listMyExports(user: RequestingUser) {
  const rows = await Repo.listExportsRepo(user.id, 20);
  return rows.map((r) => toItem(r));
}