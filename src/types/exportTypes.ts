export const EXPORT_TYPES = [
  "collections",
  "overdue",
  "weekday_sheet",
  "due_this_week",
  "customer_list",
  "loans_register",
  "closed_loans",
  "new_customers",
  "audit_log",
  "employee_performance",
  "team_summary",
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_FORMATS = ["xlsx", "csv", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "EXPIRED";

export type ExportRole = "SUPER_ADMIN" | "ADMIN" | "USER";

/** Same shape the analytics module uses. Fixed when the export is requested. */
export interface ExportScope {
  owningAdminId?: string;
  createdBy?: string;
}

/** Filters are stored as sent (already validated). */
export type ExportFilters = Record<string, string | undefined>;

export interface ExportRow {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  params: { type: ExportType; format: ExportFormat; filters: ExportFilters };
  params_hash: string;
  scope: ExportScope;
  requested_by: string;
  owning_admin_id: string | null;
  requester_role: ExportRole;
  total_rows: number | null;
  processed_rows: number;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  attempts: number;
  error: string | null;
  heartbeat_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
}

export interface ExportItem {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  filters: ExportFilters;
  total_rows: number | null;
  processed_rows: number;
  /** 0..1, or null while the total is unknown */
  progress: number | null;
  file_name: string | null;
  file_size: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  /** only on GET /:id, only when DONE and not expired */
  download_url?: string;
  download_expires_in?: number;
}

// ---- limits (tune with env, see config/env additions) -----------------------
export const EXPORT_MAX_ATTEMPTS = 3;
/** a RUNNING job with no heartbeat for this long is treated as dead. Keep in step with 014_exports_cron.sql */
export const EXPORT_STALE_MINUTES = 6;
export const EXPORT_BATCH_SIZE = 5000;
/** a PDF is built in memory, so it holds fewer rows than a spreadsheet */
export const EXPORT_MAX_PDF_ROWS = 1000;
export const EXPORT_MAX_ACTIVE_PER_USER = 2;
export const EXPORT_FILE_TTL_HOURS = 24;
export const EXPORT_URL_TTL_SECONDS = 300;

// ---- file / query definition ------------------------------------------------
export interface ExportColumn {
  header: string;
  key: string;
  width: number;
  /** text (default) | int | pct (0-100, one decimal) | date (ISO yyyy-mm-dd string in, real Excel date out) */
  kind?: "text" | "int" | "pct" | "date";
}

/** Opaque position of the last row read. Values are strings so no precision is lost. */
export type ExportCursor = Record<string, string> | null;

export interface ExportBatch {
  rows: Record<string, unknown>[];
  next: ExportCursor;
}

export interface ExportDefinition {
  roles: ExportRole[];
  /** heading of the PDF version */
  title: string;
  columns: ExportColumn[];
  count(scope: ExportScope, filters: ExportFilters): Promise<number>;
  fetch(
    scope: ExportScope,
    filters: ExportFilters,
    cursor: ExportCursor,
    size: number,
  ): Promise<ExportBatch>;
  /** file name without extension */
  label(filters: ExportFilters): string;
  /** optional custom PDF layout. Without it, a PDF is a plain table of the columns */
  renderPdf?(
    rows: Record<string, unknown>[],
    filters: ExportFilters,
  ): Promise<Buffer>;
}
