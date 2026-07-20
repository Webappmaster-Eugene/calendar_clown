import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { getUsersWithActiveDigest } from "./repository.js";
import { connectGramClient, disconnectGramClient, isDigestReady } from "./telegramClient.js";
import { runDigestForUser } from "./worker.js";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { users } from "../db/schema.js";

const log = createLogger("digest");

let digestCron: Cron | null = null;

export function startDigestScheduler(bot: Telegraf, cronExpr?: string): void {
  const expr = cronExpr ?? process.env.DIGEST_CRON ?? "0 13 * * *";

  digestCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    log.info("Digest cron triggered");
    await runAllDigests(bot);
  });

  log.info(`Digest scheduler started: "${expr}" (Europe/Moscow)`);
}

export function stopDigestScheduler(): void {
  if (digestCron) {
    digestCron.stop();
    digestCron = null;
    log.info("Digest scheduler stopped.");
  }
}

export async function runAllDigests(bot: Telegraf): Promise<number> {
  if (!await isDigestReady()) {
    log.warn("Digest skipped: session not ready.");
    return 0;
  }

  let totalProcessed = 0;
  let usersCount = 0;

  try {
    await connectGramClient();

    const dbUserIds = await getUsersWithActiveDigest();
    usersCount = dbUserIds.length;
    if (dbUserIds.length === 0) {
      log.info("No users with active digest rubrics.");
      return 0;
    }

    for (const dbUserId of dbUserIds) {
      const [row] = await db
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(eq(users.id, dbUserId));
      if (!row) continue;
      const telegramId = Number(row.telegramId);
      if (!Number.isFinite(telegramId) || telegramId <= 0) {
        log.warn(`Invalid telegram_id for dbUser ${dbUserId}: ${row.telegramId}`);
        continue;
      }

      try {
        const count = await runDigestForUser(telegramId, bot);
        totalProcessed += count;
      } catch (err) {
        log.error(`Digest failed for user ${telegramId}:`, err);
      }

      if (dbUserIds.indexOf(dbUserId) < dbUserIds.length - 1) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  } catch (err) {
    log.error("Fatal digest error:", err);
  } finally {
    await disconnectGramClient();
  }

  log.info(`Digest run complete: ${totalProcessed} rubrics processed.`);
  logAction(null, null, "scheduler_digest_run", { usersProcessed: usersCount, rubricsProcessed: totalProcessed });
  return totalProcessed;
}
