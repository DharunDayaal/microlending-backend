// Small SQL helpers shared by every export definition.
import type {
  ExportCursor,
  ExportFilters,
  ExportScope,
} from "../../types/exportTypes";

export const TZ = "Asia/Kolkata";
export const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;

export const todayIst = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TZ });

/** Display name of a users row: name, else email, else phone. */
export const NAME = (a: string) =>
  `COALESCE(NULLIF(${a}.user_name, ''), NULLIF(${a}.email, ''), ${a}.phone_number)`;

/** " AND l.owning_admin_id = $n AND u.created_by = $m"  (aliases: l loans, u customers) */
export function loanScopeSql(scope: ExportScope, values: unknown[]): string {
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND l.owning_admin_id = $${values.length}`;
  }
  if (scope.createdBy) {
    values.push(scope.createdBy);
    clause += ` AND u.created_by = $${values.length}`;
  }
  return clause;
}

/** Same, for queries that start from customers (alias u). */
export function custScopeSql(scope: ExportScope, values: unknown[]): string {
  let clause = "";
  if (scope.owningAdminId) {
    values.push(scope.owningAdminId);
    clause += ` AND u.owning_admin_id = $${values.length}`;
  }
  if (scope.createdBy) {
    values.push(scope.createdBy);
    clause += ` AND u.created_by = $${values.length}`;
  }
  return clause;
}

export const req = (f: ExportFilters, key: string): string => {
  const v = f[key];
  if (!v) throw new Error(`Missing filter: ${key}`);
  return v;
};

/** Adds a value to the parameter list and returns its placeholder ("$3"). */
export const param = (values: unknown[], v: unknown): string => {
  values.push(v);
  return `$${values.length}`;
};

/** IST calendar day of a timestamp column. */
export const istDay = (col: string) => `(${col} AT TIME ZONE '${TZ}')::date`;

/** Next cursor: the last row's key when the batch was full, otherwise done. */
export function nextCursor(
  rows: Record<string, unknown>[],
  size: number,
  make: (last: Record<string, unknown>) => Record<string, string>,
): ExportCursor {
  const last = rows[rows.length - 1];
  return rows.length === size && last ? make(last) : null;
}
