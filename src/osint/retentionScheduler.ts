/**
 * Daily retention job for OSINT: clears old raw_results payloads so the table
 * doesn't grow unbounded from multi-MB Tavily responses.
 */

import { Cron } from "croner";
import { createLogger } from "../utils/logger.js";
import { pruneOldRawResults } from "./repository.js";

const log = createLogger("osint-retention");

let retentionCron: Cron | null = null;

/** Start the OSINT retention job (daily; clears raw_results older than N days). */
export function startOsintRetention(): void {
  const expr = process.env.OSINT_RETENTION_CRON ?? "30 4 * * *";
  const days = Number(process.env.OSINT_RAW_RETENTION_DAYS ?? 30);
  if (!Number.isFinite(days) || days < 1) {
    log.warn(`Invalid OSINT_RAW_RETENTION_DAYS (${process.env.OSINT_RAW_RETENTION_DAYS}) — retention disabled.`);
    return;
  }

  retentionCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    try {
      const cleared = await pruneOldRawResults(days);
      if (cleared > 0) log.info(`Cleared raw_results from ${cleared} OSINT search(es) older than ${days}d.`);
    } catch (err) {
      log.error("OSINT retention job failed:", err instanceof Error ? err.message : err);
    }
  });

  log.info(`OSINT retention started: "${expr}" (Europe/Moscow), keep ${days}d`);
}

/** Stop the retention job. */
export function stopOsintRetention(): void {
  if (retentionCron) {
    retentionCron.stop();
    retentionCron = null;
    log.info("OSINT retention stopped.");
  }
}
