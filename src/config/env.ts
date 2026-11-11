import { config } from "dotenv";
import { resolve } from "path";

config({
  path: resolve(process.cwd(), ".env"),
});

export const {
  NODE_ENV,
  PORT,
  LOG_LEVEL,
  DATABASE_URL,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  SET_RATE_LIMIT,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  EXPORT_WORKER_SECRET,
  EXPORT_BUCKET = process.env.EXPORT_BUCKET ?? "exports",
  EXPORT_MAX_XLSX_ROWS = Number(process.env.EXPORT_MAX_XLSX_ROWS ?? 100000),
  EXPORT_MAX_CSV_ROWS = Number(process.env.EXPORT_MAX_CSV_ROWS ?? 300000),
} = process.env;
