/**
 * Cron scheduler for daily digest.
 * Runs at configured time (default 13:00 MSK) and triggers digest for all users.
 */

import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { getUsersWithActiveDigest } from "./repository.js";
import { connectGramClient, disconnectGramClient, isDigestReady } from "./telegramClient.js";
import { runDigestForUser } from "./worker.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { query } from "../db/connection.js";

const log = createLogger("digest");

let digestCron: Cron | null = null;

/**
 * Start the daily digest scheduler.
 * @param bot Telegraf instance for sending messages.
 * @param cronExpr Cron expression (default: "0 13 * * *" = 13:00 daily).
 */
export function startDigestScheduler(bot: Telegraf, cronExpr?: string): void {
  const expr = cronExpr ?? process.env.DIGEST_CRON ?? "0 13 * * *";

  digestCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    log.info("Digest cron triggered");
    await runAllDigests(bot);
  });

  log.info(`Digest scheduler started: "${expr}" (Europe/Moscow)`);
}

/** Stop the digest scheduler. */
export function stopDigestScheduler(): void {
  if (digestCron) {
    digestCron.stop();
    digestCron = null;
    log.info("Digest scheduler stopped.");
  }
}

/**
 * Run digest for all users with active rubrics.
 * Called by cron or manually via /digest now.
 */
export async function runAllDigests(bot: Telegraf): Promise<number> {
  if (!await isDigestReady()) {
    log.warn("Digest skipped: session not ready.");
    return 0;
  }

  let totalProcessed = 0;

  try {
    // Connect GramJS before processing
    await connectGramClient();

    // Get all user IDs (DB internal) who have active rubrics with channels
    const dbUserIds = await getUsersWithActiveDigest();
    if (dbUserIds.length === 0) {
      log.info("No users with active digest rubrics.");
      return 0;
    }

    // Resolve DB user IDs to telegram IDs
    for (const dbUserId of dbUserIds) {
      const { rows } = await query<{ telegram_id: string }>(
        "SELECT telegram_id FROM users WHERE id = $1",
        [dbUserId]
      );
      if (rows.length === 0) continue;
      const telegramId = Number(rows[0].telegram_id);

      try {
        const count = await runDigestForUser(telegramId, bot);
        totalProcessed += count;
      } catch (err) {
        log.error(`Digest failed for user ${telegramId}:`, err);
      }

      // Pause between users
      if (dbUserIds.indexOf(dbUserId) < dbUserIds.length - 1) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  } catch (err) {
    log.error("Fatal digest error:", err);
  } finally {
    // Disconnect GramJS after all digests are done
    await disconnectGramClient();
  }

  log.info(`Digest run complete: ${totalProcessed} rubrics processed.`);
  return totalProcessed;
}
