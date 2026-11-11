// place at: src/services/exportWorker.ts
// Runs ONE export per call. Called by the protected /api/internal/exports/run
// route, which pg_cron triggers while jobs are waiting.
import fs from "node:fs";
import { withTransaction } from "../../config/database";
import { AUDIT } from "../../constants/auditActions";
import { logger } from "../../helpers";
import * as Repo from "../../repositories/exportRepo";
import { EXPORTS } from "../../repositories/exportRepo/exportQueries";
import { recordAudit } from "../../services/auditService";
import { maxRowsFor } from "../../services/exportService";
import { removeExportFiles, uploadExportFile } from "./exportStorage";
import { EXPORT_BATCH_SIZE } from "../../types/exportTypes";
import type { ExportCursor } from "../../types/exportTypes";
import { CONTENT_TYPE, createSink, removeQuietly, tmpFilePath } from "../../utils/exportFile";

/** Retrying will not help (bad type, too many rows): fail now and show this message. */
class PermanentError extends Error {}
/** Another worker took this job over, so stop quietly. */
class LostJobError extends Error {}

export type RunResult =
  | { ran: false }
  | { ran: true; id: string; status: string; rows?: number; ms?: number };

export async function runNextExport(): Promise<RunResult> {
  const job = await Repo.claimNextExportRepo();
  if (!job) return { ran: false };

  const started = Date.now();
  const def = EXPORTS[job.type];
  const tmp = tmpFilePath(job.id, job.format);
  const sink = def ? createSink(job.format, def.columns, job.id) : null;

  try {
    if (!def || !sink) throw new PermanentError("This report type is no longer available.");
    const filters = job.params?.filters ?? {};

    const total = await def.count(job.scope, filters);
    const cap = maxRowsFor(job.format);
    if (total > cap) {
      throw new PermanentError(
        `This export now has ${total} rows, over the limit of ${cap}. Narrow the filters.`,
      );
    }
    await Repo.setExportTotalRepo(job.id, total);

    let cursor: ExportCursor = null;
    let processed = 0;
    do {
      const batch = await def.fetch(job.scope, filters, cursor, EXPORT_BATCH_SIZE);
      await sink.addBatch(batch.rows);
      processed += batch.rows.length;
      cursor = batch.next;
      if (!(await Repo.heartbeatExportRepo(job.id, processed))) throw new LostJobError();
    } while (cursor);

    const { filePath, size } = await sink.finish();
    const fileName = `${def.label(filters)}.${job.format}`;
    const storagePath = `${job.owning_admin_id ?? "platform"}/${job.requested_by}/${job.id}.${job.format}`;

    await uploadExportFile(
      storagePath,
      await fs.promises.readFile(filePath),
      CONTENT_TYPE[job.format],
    );

    // the DONE flag and its audit row commit together
    await withTransaction(async (client) => {
      const done = await Repo.markExportDoneRepo(client, job.id, {
        filePath: storagePath,
        fileName,
        size,
        rows: processed,
      });
      if (!done) throw new LostJobError();
      await recordAudit(client, {
        action: AUDIT.DATA_EXPORTED,
        actor_id: job.requested_by,
        owning_admin_id: job.scope.owningAdminId ?? job.owning_admin_id,
        meta: {
          export_id: job.id,
          type: job.type,
          format: job.format,
          rows: processed,
          file_size: size,
          filters,
        },
      });
    });

    const ms = Date.now() - started;
    logger.info(`Export ${job.id} (${job.type}/${job.format}) done: ${processed} rows, ${size} bytes, ${ms} ms`);
    return { ran: true, id: job.id, status: "DONE", rows: processed, ms };
  } catch (err) {
    await sink?.abort().catch(() => undefined);

    if (err instanceof LostJobError) {
      logger.warn(`Export ${job.id}: another worker took over, stopping`);
      return { ran: true, id: job.id, status: "LOST" };
    }

    const permanent = err instanceof PermanentError;
    logger.error(err, `Export ${job.id} failed (attempt ${job.attempts}):`);
    const status = await Repo.failOrRequeueExportRepo(
      job.id,
      permanent ? (err as Error).message : "The export failed. Please try again.",
      permanent,
    );
    return { ran: true, id: job.id, status: status ?? "UNKNOWN" };
  } finally {
    await removeQuietly(tmp);
  }
}

/** Nightly: delete expired files through the Storage API, then old finished rows. */
export async function cleanupExports(): Promise<{ removed: number; purged: number }> {
  let removed = 0;
  for (;;) {
    const batch = await Repo.findExpiredExportsRepo(200);
    if (batch.length === 0) break;
    await removeExportFiles(batch.map((b) => b.file_path));
    await Repo.markExportsExpiredRepo(batch.map((b) => b.id));
    removed += batch.length;
    if (batch.length < 200) break;
  }
  const purged = await Repo.purgeOldExportsRepo(30);
  return { removed, purged };
}