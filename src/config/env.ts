import { config } from "dotenv";
import { resolve } from "path";

config({
  path: resolve(process.cwd(), ".env"),
});

export const { NODE_ENV, PORT, LOG_LEVEL, DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } = process.env;
