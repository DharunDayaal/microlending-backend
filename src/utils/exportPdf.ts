// PDF output for exports.
//  - renderWeekdaySheet: the weekday collection sheet (one block per loan).
//  - renderTablePdf: every other export, as a plain table of its columns.
// Weekday sheet blocks: customer, referrer ("-" if none), loan details, and what the
// customer paid in each week up to the current week (unpaid weeks show 0).
// Needs: npm i pdfkit && npm i -D @types/pdfkit
// Fonts live in src/assets/fonts (Noto Sans + Noto Sans Tamil, SIL Open Font License).
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { logger } from "../helpers";
import type { ExportColumn } from "../types/exportTypes";

type Doc = InstanceType<typeof PDFDocument>;

export interface SheetWeek {
  week: number;
  /** what the customer paid for this week (0 if nothing) */
  paid: number;
}

/** One row of the weekday_sheet export (one per loan). */
export interface SheetLoan {
  loan_ref: string;
  status: "ACTIVE" | "OVERDUE";
  issued_date: string; // yyyy-mm-dd (IST)
  nominal_amount: number;
  upfront_fee: number;
  disbursed_amount: number;
  total_payable_amount: number;
  weekly_payable_amount: number;
  total_months: number;
  total_weeks: number;
  current_week: number;
  customer_name: string;
  phone_number: string;
  street_name: string | null;
  city: string | null;
  district: string | null;
  payment_day: string;
  referrer_name: string | null;
  referrer_phone: string | null;
  referrer_city: string | null;
  weeks: SheetWeek[];
}

// ---- page geometry (A4, points) ---------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const CONTENT_W = PAGE_W - 2 * M;
const FOOTER_H = 22;
const BOTTOM = PAGE_H - M - FOOTER_H;

// ---- block geometry ---------------------------------------------------------
const PAD = 10;
const BLOCK_GAP = 8;
const CELL_W = 62;
const CELL_H = 15;
const CELLS_PER_ROW = Math.floor((CONTENT_W - 2 * PAD) / CELL_W);

// ---- colors -----------------------------------------------------------------
const INK = "#111827";
const MUTED = "#6B7280";
const LINE = "#E5E7EB";
const GREEN = { bg: "#DCFCE7", fg: "#15803D" };
const RED = { bg: "#FEE2E2", fg: "#B91C1C" };

// ---- fonts ------------------------------------------------------------------
const FONT_DIRS = [
  path.join(process.cwd(), "src/assets/fonts"),
  path.join(__dirname, "../assets/fonts"),
];
type FontSet = { L: string; LB: string; T: string; TB: string };

function loadFonts(doc: Doc): FontSet {
  const dir = FONT_DIRS.find((d) =>
    fs.existsSync(path.join(d, "NotoSans-Regular.woff")),
  );
  if (!dir) {
    logger.warn(
      "PDF fonts not found; Tamil text will not print. Looked in: " +
        FONT_DIRS.join(", "),
    );
    return {
      L: "Helvetica",
      LB: "Helvetica-Bold",
      T: "Helvetica",
      TB: "Helvetica-Bold",
    };
  }
  doc.registerFont("L", path.join(dir, "NotoSans-Regular.woff"));
  doc.registerFont("LB", path.join(dir, "NotoSans-Bold.woff"));
  doc.registerFont("T", path.join(dir, "NotoSansTamil-Regular.woff"));
  doc.registerFont("TB", path.join(dir, "NotoSansTamil-Bold.woff"));
  return { L: "L", LB: "LB", T: "T", TB: "TB" };
}

// ---- text helpers -----------------------------------------------------------
// The Tamil font has no Latin letters, digits or spaces, so text is split into
// Tamil runs and everything-else runs, each drawn with its own font.
const TAMIL_RUN = /[஀-௿‌‍]+/g;

function splitRuns(s: string): { text: string; tamil: boolean }[] {
  const out: { text: string; tamil: boolean }[] = [];
  let last = 0;
  for (const m of s.matchAll(TAMIL_RUN)) {
    if (m.index! > last)
      out.push({ text: s.slice(last, m.index), tamil: false });
    out.push({ text: m[0], tamil: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), tamil: false });
  return out;
}

const segmenter = new Intl.Segmenter("ta", { granularity: "grapheme" });

interface Ctx {
  doc: Doc;
  f: FontSet;
}

interface TextOpts {
  size: number;
  bold?: boolean;
  color?: string;
  maxWidth?: number;
}

function fontFor(c: Ctx, tamil: boolean, bold?: boolean): string {
  return tamil ? (bold ? c.f.TB : c.f.T) : bold ? c.f.LB : c.f.L;
}

function measure(c: Ctx, s: string, o: TextOpts): number {
  let w = 0;
  for (const run of splitRuns(s)) {
    c.doc.font(fontFor(c, run.tamil, o.bold)).fontSize(o.size);
    w += c.doc.widthOfString(run.text);
  }
  return w;
}

/** shortens with an ellipsis without cutting a Tamil letter in half */
function fit(c: Ctx, s: string, o: TextOpts): string {
  if (!o.maxWidth) return s;
  // very long text (audit values): cut to a generous upper bound before measuring
  const limit = Math.ceil(o.maxWidth / (o.size * 0.3)) + 2;
  if (s.length > limit) s = s.slice(0, limit);
  if (measure(c, s, o) <= o.maxWidth) return s;
  const parts = [...segmenter.segment(s)].map((x) => x.segment);
  while (parts.length > 1) {
    parts.pop();
    const t = parts.join("").trimEnd() + "...";
    if (measure(c, t, o) <= o.maxWidth) return t;
  }
  return parts.join("");
}

/** draws on a baseline so Tamil and Latin runs line up; returns the width drawn */
function put(
  c: Ctx,
  s: string,
  x: number,
  baseline: number,
  o: TextOpts,
): number {
  const text = fit(c, s, o);
  let cx = x;
  c.doc.fillColor(o.color ?? INK);
  for (const run of splitRuns(text)) {
    c.doc.font(fontFor(c, run.tamil, o.bold)).fontSize(o.size);
    c.doc.text(run.text, cx, baseline, {
      lineBreak: false,
      baseline: "alphabetic",
    });
    cx += c.doc.widthOfString(run.text);
  }
  return cx - x;
}

function putRight(
  c: Ctx,
  s: string,
  right: number,
  baseline: number,
  o: TextOpts,
): void {
  const text = fit(c, s, o);
  put(c, text, right - measure(c, text, o), baseline, {
    ...o,
    maxWidth: undefined,
  });
}

function putCentered(
  c: Ctx,
  s: string,
  centerX: number,
  baseline: number,
  o: TextOpts,
): void {
  const w = measure(c, s, o);
  put(c, s, centerX - w / 2, baseline, { ...o, maxWidth: undefined });
}

// ---- formatting -------------------------------------------------------------
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}
const rs = (n: number) => `Rs ${Math.round(Number(n)).toLocaleString("en-IN")}`;
const num = (n: number) => Math.round(Number(n)).toLocaleString("en-IN");
const cap = (w: string) => w.charAt(0) + w.slice(1).toLowerCase();

function fmtMonths(m: number): string {
  m = Number(m);
  return `${Number.isInteger(m) ? m : m.toFixed(1)} month${m === 1 ? "" : "s"}`;
}

// ---- block ------------------------------------------------------------------
function blockHeight(l: SheetLoan): number {
  const rows = Math.max(1, Math.ceil(l.weeks.length / CELLS_PER_ROW));
  return PAD + 18 + 13 + 13 + 13 + 13 + 4 + rows * CELL_H + PAD;
}

function drawBlock(c: Ctx, l: SheetLoan, index: number, top: number): void {
  const { doc } = c;
  const w = CONTENT_W;
  const inner = w - 2 * PAD;
  const left = M + PAD;
  const right = M + w - PAD;
  const h = blockHeight(l);

  doc.roundedRect(M, top, w, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
  let y = top + PAD;

  // customer
  const badge = l.status === "OVERDUE" ? RED : GREEN;
  put(c, `${index}.`, left, y + 11, { size: 9, color: MUTED });
  put(c, l.customer_name, left + 18, y + 11, {
    size: 12,
    bold: true,
    maxWidth: inner - 18 - 70,
  });
  doc
    .roundedRect(right - 58, y - 1, 58, 15, 7)
    .fillColor(badge.bg)
    .fill();
  putCentered(c, l.status, right - 29, y + 9.5, {
    size: 7.5,
    bold: true,
    color: badge.fg,
  });
  y += 18;

  const address = [l.street_name, l.city, l.district]
    .filter(Boolean)
    .join(", ");
  const contact = [
    l.phone_number,
    address || "-",
    `Pays on ${cap(l.payment_day)}`,
  ].join("  |  ");
  put(c, contact, left, y + 8, { size: 8.5, color: MUTED, maxWidth: inner });
  y += 13;

  // referral: details if available, otherwise "-"
  const labelW = put(c, "Referred by: ", left, y + 8, {
    size: 8.5,
    color: MUTED,
  });
  const referrer = l.referrer_name
    ? [l.referrer_name, l.referrer_phone, l.referrer_city]
        .filter(Boolean)
        .join("  |  ")
    : "-";
  put(c, referrer, left + labelW, y + 8, {
    size: 8.5,
    bold: !!l.referrer_name,
    maxWidth: inner - labelW,
  });
  y += 13;

  // loan details
  put(
    c,
    `Loan #${String(l.loan_ref).toUpperCase()}  |  Issued ${fmtDate(l.issued_date)}  |  Week ${l.current_week} of ${l.total_weeks}  |  Term ${fmtMonths(l.total_months)}`,
    left,
    y + 8,
    { size: 8.5, maxWidth: inner },
  );
  y += 13;
  put(
    c,
    `Principal ${rs(l.nominal_amount)}  |  Fee ${rs(l.upfront_fee)}  |  Disbursed ${rs(l.disbursed_amount)}  |  Total payable ${rs(l.total_payable_amount)}  |  Weekly ${rs(l.weekly_payable_amount)}`,
    left,
    y + 8,
    { size: 8.5, maxWidth: inner },
  );
  y += 13 + 4;

  // weeks: "W1 - 300"  (0 in red when nothing was paid)
  l.weeks.forEach((wk, i) => {
    const cx = left + (i % CELLS_PER_ROW) * CELL_W;
    const cy = y + Math.floor(i / CELLS_PER_ROW) * CELL_H;
    const paid = Number(wk.paid);
    const used = put(c, `W${wk.week} - `, cx, cy + 10, {
      size: 8.5,
      color: MUTED,
    });
    put(c, num(paid), cx + used, cy + 10, {
      size: 9,
      bold: true,
      color: paid > 0 ? GREEN.fg : RED.fg,
    });
  });
}

function runningHeader(c: Ctx, weekday: string): number {
  put(c, `Weekly collection sheet  |  ${cap(weekday)}`, M, M + 8, {
    size: 8.5,
    color: MUTED,
  });
  c.doc
    .moveTo(M, M + 15)
    .lineTo(PAGE_W - M, M + 15)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  return M + 24;
}

export interface SheetInput {
  weekday: string;
  loans: SheetLoan[];
  generatedAt: Date;
}

export function renderWeekdaySheet(input: SheetInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: M,
      bufferPages: true,
      info: {
        Title: `Weekly collection sheet - ${cap(input.weekday)}`,
        Author: "Micro lending",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const c: Ctx = { doc, f: loadFonts(doc) };
      const { loans } = input;

      put(c, "Weekly collection sheet", M, M + 14, { size: 17, bold: true });
      putRight(c, input.weekday, PAGE_W - M, M + 14, {
        size: 17,
        bold: true,
        color: "#1D4ED8",
      });
      const generated = input.generatedAt.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      put(
        c,
        `Generated ${generated} IST  |  ${loans.length} loan${loans.length === 1 ? "" : "s"}  |  W = amount paid that week`,
        M,
        M + 30,
        { size: 8.5, color: MUTED },
      );
      let y = M + 46;

      if (loans.length === 0) {
        put(
          c,
          `No active or overdue loans for customers who pay on ${cap(input.weekday)}.`,
          M,
          y + 20,
          { size: 11, color: MUTED },
        );
      }

      loans.forEach((l, i) => {
        const h = blockHeight(l);
        if (y + h > BOTTOM) {
          doc.addPage();
          y = runningHeader(c, input.weekday);
        }
        drawBlock(c, l, i + 1, y);
        y += h + BLOCK_GAP;
      });

      // page numbers (bottom margin lifted so the footer does not start a new page)
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const keep = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        putRight(
          c,
          `Page ${i + 1} of ${range.count}`,
          PAGE_W - M,
          PAGE_H - M + 4,
          { size: 8, color: MUTED },
        );
        doc.page.margins.bottom = keep;
      }
      doc.end();
    } catch (err) {
      doc.end();
      reject(err);
    }
  });
}

// ===========================================================================
// Generic table PDF (landscape A4): header row repeats on every page
// ===========================================================================
const LW = PAGE_H; // landscape width
const LH = PAGE_W; // landscape height
const TM = 28;
const T_CONTENT_W = LW - 2 * TM;
const ROW_H = 15;
const HEAD_H = 18;
const T_BOTTOM = LH - TM - 14;

const HEAD_BG = "#F3F4F6";
const ZEBRA = "#FAFAFA";

export interface TableInput {
  title: string;
  /** one line under the title (filters etc.) */
  subtitle?: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  generatedAt: Date;
}

function cellText(col: ExportColumn, v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (col.kind === "int") return num(Number(v));
  if (col.kind === "pct") return `${Number(v).toFixed(1)}%`;
  if (
    col.kind === "date" &&
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v)
  )
    return fmtDate(v);
  return String(v).replace(/\s+/g, " ").trim();
}

export function renderTablePdf(input: TableInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: TM,
      bufferPages: true,
      info: { Title: input.title, Author: "Micro lending" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const c: Ctx = { doc, f: loadFonts(doc) };
      const { columns, rows } = input;
      const size = columns.length > 11 ? 6.5 : columns.length > 8 ? 7.5 : 8.5;
      const padX = 3;

      // column widths: proportional to the Excel widths, filling the page
      // (a column is never narrower than its own header)
      const weight = columns.map((col) =>
        Math.max(col.width, col.header.length + 3),
      );
      const totalW = weight.reduce((s, w) => s + w, 0);
      const widths = weight.map((w) => (w / totalW) * T_CONTENT_W);
      const xs: number[] = [];
      widths.reduce((x, w) => (xs.push(x), x + w), TM);

      const drawHead = (y: number): number => {
        doc.rect(TM, y, T_CONTENT_W, HEAD_H).fillColor(HEAD_BG).fill();
        columns.forEach((col, i) => {
          const o = { size, bold: true, maxWidth: widths[i] - 2 * padX };
          const right = col.kind === "int" || col.kind === "pct";
          if (right)
            putRight(c, col.header, xs[i] + widths[i] - padX, y + 12, o);
          else put(c, col.header, xs[i] + padX, y + 12, o);
        });
        return y + HEAD_H;
      };

      const generated = input.generatedAt.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      put(c, input.title, TM, TM + 14, { size: 16, bold: true });
      const sub = [
        input.subtitle,
        `${rows.length} row${rows.length === 1 ? "" : "s"}`,
        `Generated ${generated} IST`,
      ]
        .filter(Boolean)
        .join("  |  ");
      put(c, sub, TM, TM + 30, {
        size: 8.5,
        color: MUTED,
        maxWidth: T_CONTENT_W,
      });
      let y = drawHead(TM + 40);

      if (rows.length === 0) {
        put(c, "No rows match these filters.", TM, y + 20, {
          size: 11,
          color: MUTED,
        });
      }

      rows.forEach((row, ri) => {
        if (y + ROW_H > T_BOTTOM) {
          doc.addPage();
          y = drawHead(TM);
        }
        if (ri % 2 === 1)
          doc.rect(TM, y, T_CONTENT_W, ROW_H).fillColor(ZEBRA).fill();
        columns.forEach((col, i) => {
          const text = cellText(col, row[col.key]);
          const o = { size, maxWidth: widths[i] - 2 * padX };
          if (col.kind === "int" || col.kind === "pct") {
            putRight(c, text, xs[i] + widths[i] - padX, y + 10.5, o);
          } else {
            put(c, text, xs[i] + padX, y + 10.5, o);
          }
        });
        y += ROW_H;
      });

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const keep = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        putRight(c, `Page ${i + 1} of ${range.count}`, LW - TM, LH - TM + 6, {
          size: 8,
          color: MUTED,
        });
        doc.page.margins.bottom = keep;
      }
      doc.end();
    } catch (err) {
      doc.end();
      reject(err);
    }
  });
}
