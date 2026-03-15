/**
 * Cron scheduler for notable date reminders.
 * Runs at 10:00 and 17:00 MSK daily and sends reminders for today's dates.
 */

import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { getDatesByMonthDay } from "./repository.js";
import { formatDayReminders } from "./service.js";
import { listTribeUsers } from "../expenses/repository.js";
import { query } from "../db/connection.js";

const log = createLogger("notable-dates");

let notableDatesCron: Cron | null = null;

/** Start the notable dates reminder scheduler. */
export function startNotableDatesScheduler(bot: Telegraf): void {
  const expr = process.env.NOTABLE_DATES_CRON ?? "0 10,17 * * *";

  notableDatesCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    log.info("Notable dates cron triggered");
    await sendNotableDateReminders(bot);
  });

  log.info(`Notable dates scheduler started: "${expr}" (Europe/Moscow)`);
}

/** Stop the scheduler. */
export function stopNotableDatesScheduler(): void {
  if (notableDatesCron) {
    notableDatesCron.stop();
    notableDatesCron = null;
    log.info("Notable dates scheduler stopped.");
  }
}

/** Send reminders for today's notable dates to all tribes. */
async function sendNotableDateReminders(bot: Telegraf): Promise<void> {
  const now = new Date();
  // Use Moscow timezone for month/day
  const mskDate = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const month = mskDate.getMonth() + 1;
  const day = mskDate.getDate();

  log.info(`Checking notable dates for ${day}.${month}`);

  // Get all tribes
  const { rows: tribes } = await query<{ id: number }>("SELECT id FROM tribes");

  for (const tribe of tribes) {
    try {
      const dates = await getDatesByMonthDay(tribe.id, month, day);
      if (dates.length === 0) continue;

      const message = formatDayReminders(dates);
      if (!message) continue;

      // Send to all tribe members
      const users = await listTribeUsers(tribe.id);
      let sent = 0;
      for (const user of users) {
        try {
          await bot.telegram.sendMessage(user.telegramId, message, { parse_mode: "Markdown" });
          sent++;
        } catch (err) {
          log.error(`Failed to send notable date reminder to user ${user.telegramId}:`, err);
        }
      }

      log.info(`Tribe ${tribe.id}: sent ${sent}/${users.length} notable date reminders (${dates.length} dates)`);
    } catch (err) {
      log.error(`Error processing notable dates for tribe ${tribe.id}:`, err);
    }
  }
}
