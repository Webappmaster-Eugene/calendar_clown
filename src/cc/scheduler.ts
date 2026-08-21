// Archives bridge topics nobody has used in a while.
//
// Closing rather than deleting: a closed forum topic gets a lock icon, sinks in
// the list and stops competing for attention, but its history survives and the
// next session reopens it automatically. Deletion stays a deliberate, manual act
// — a bot destroying conversations on a timer is not a trade worth making.
import { Cron } from "croner";
import { createLogger } from "../utils/logger.js";
import { archiveStaleTopics } from "../services/ccBridgeService.js";

const log = createLogger("cc-scheduler");

let cron: Cron | null = null;

export function startCcScheduler(): void {
  const expr = process.env.CC_ARCHIVE_CRON ?? "20 5 * * *";
  const days = Number(process.env.CC_ARCHIVE_DAYS ?? 30);

  if (!Number.isFinite(days) || days < 1) {
    log.warn("CC_ARCHIVE_DAYS=%s is not a positive number — archiving disabled", process.env.CC_ARCHIVE_DAYS);
    return;
  }

  cron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    try {
      const closed = await archiveStaleTopics(days);
      if (closed > 0) log.info("archived %d idle topics", closed);
    } catch (err) {
      log.error("archive run failed: %s", err instanceof Error ? err.message : String(err));
    }
  });

  log.info(`CC archive scheduler started: "${expr}" (Europe/Moscow), after ${days} idle days`);
}

export function stopCcScheduler(): void {
  if (cron) {
    cron.stop();
    cron = null;
    log.info("CC archive scheduler stopped.");
  }
}
