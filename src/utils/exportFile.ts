// Builds the export file on local disk one batch at a time, so memory stays flat
// however many rows there are. Needs: npm i exceljs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import type { ExportColumn, ExportFormat } from "../types/exportTypes";

export interface RowSink {
  addBatch(rows: Record<string, unknown>[]): Promise<void>;
  finish(): Promise<{ filePath: string; size: number }>;
  /** close and delete the half-written file */
  abort(): Promise<void>;
}

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function tmpFilePath(id: string, format: ExportFormat): string {
  return path.join(os.tmpdir(), `export-${id}.${format}`);
}

async function removeQuietly(filePath: string): Promise<void> {
  await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
function cellValue(col: ExportColumn, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (col.kind === "date" && typeof v === "string" && ISO_DATE.test(v)) {
    return new Date(`${v}T00:00:00Z`); // UTC midnight = the same calendar day in Excel
  }
  if (col.kind === "int" || col.kind === "pct") return Number(v);
  return String(v); // always a string cell, so text can never run as a formula
}

function xlsxSink(filePath: string, columns: ExportColumn[]): RowSink {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet("Export", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style:
      c.kind === "int"
        ? { numFmt: "#,##0" }
        : c.kind === "pct"
          ? { numFmt: '0.0"%"' }
          : c.kind === "date"
            ? { numFmt: "dd mmm yyyy" }
            : {},
  }));
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.commit();

  return {
    async addBatch(rows) {
      for (const row of rows) {
        const values = columns.map((c) => cellValue(c, row[c.key]));
        ws.addRow(values).commit();
      }
    },
    async finish() {
      await ws.commit();
      await wb.commit();
      const { size } = await fs.promises.stat(filePath);
      return { filePath, size };
    },
    async abort() {
      await wb.commit().catch(() => undefined);
      await removeQuietly(filePath);
    },
  };
}

// ---------------------------------------------------------------------------
// CSV (UTF-8 with BOM so Excel shows Tamil and other scripts correctly)
// ---------------------------------------------------------------------------
const PHONE_LIKE = /^[+-]?[\d\s()-]+$/;

/** Stops Excel from running a text value as a formula when the CSV is opened. */
function csvSafe(s: string): string {
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !PHONE_LIKE.test(s)) return `'${s}`;
  return s;
}

function csvCell(col: ExportColumn, v: unknown): string {
  if (v === null || v === undefined) return "";
  const raw =
    col.kind === "int" || col.kind === "pct"
      ? String(Number(v))
      : csvSafe(String(v));
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvSink(filePath: string, columns: ExportColumn[]): RowSink {
  const stream = fs.createWriteStream(filePath);
  const write = (chunk: string) =>
    new Promise<void>((resolve, reject) =>
      stream.write(chunk, (err) => (err ? reject(err) : resolve())),
    );
  let started = false;

  const start = async () => {
    if (started) return;
    started = true;
    const head = columns
      .map((c) => csvCell({ ...c, kind: "text" }, c.header))
      .join(",");
    await write(`﻿${head}\r\n`);
  };

  return {
    async addBatch(rows) {
      await start();
      let chunk = "";
      for (const row of rows) {
        chunk += columns.map((c) => csvCell(c, row[c.key])).join(",") + "\r\n";
      }
      if (chunk) await write(chunk);
    },
    async finish() {
      await start();
      await new Promise<void>((resolve, reject) => {
        stream.once("error", reject);
        stream.end(() => resolve());
      });
      const { size } = await fs.promises.stat(filePath);
      return { filePath, size };
    },
    async abort() {
      stream.destroy();
      await removeQuietly(filePath);
    },
  };
}

// ---------------------------------------------------------------------------
// PDF: rows are kept in memory (the row cap for PDF is small) and drawn at the end
// ---------------------------------------------------------------------------
export type PdfRenderer = (rows: Record<string, unknown>[]) => Promise<Buffer>;

function pdfSink(filePath: string, render: PdfRenderer | undefined): RowSink {
  const all: Record<string, unknown>[] = [];
  return {
    async addBatch(rows) {
      all.push(...rows);
    },
    async finish() {
      if (!render) throw new Error("This report cannot be made as a PDF");
      await fs.promises.writeFile(filePath, await render(all));
      const { size } = await fs.promises.stat(filePath);
      return { filePath, size };
    },
    async abort() {
      all.length = 0;
      await removeQuietly(filePath);
    },
  };
}

export function createSink(
  format: ExportFormat,
  columns: ExportColumn[],
  jobId: string,
  renderPdf?: PdfRenderer,
): RowSink {
  const filePath = tmpFilePath(jobId, format);
  if (format === "pdf") return pdfSink(filePath, renderPdf);
  return format === "xlsx"
    ? xlsxSink(filePath, columns)
    : csvSink(filePath, columns);
}

export { removeQuietly };
