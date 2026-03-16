/**
 * Cron scheduler for notable date reminders.
 * Runs at 10:00 and 17:00 MSK daily.
 * Sends reminders for today's dates AND advance reminders (7, 3, 1 days before).
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

/** Advance reminder intervals in days. */
const ADVANCE_DAYS = [7, 3, 1] as const;

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

/** Get a future date in Moscow timezone. */
function getMskFutureDate(daysAhead: number): { month: number; day: number } {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const mskDate = new Date(future.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  return { month: mskDate.getMonth() + 1, day: mskDate.getDate() };
}

/** Format advance reminder prefix. */
function formatAdvancePrefix(daysAhead: number): string {
  if (daysAhead === 1) return "Завтра";
  if (daysAhead === 3) return "Через 3 дня";
  if (daysAhead === 7) return "Через 7 дней";
  return `Через ${daysAhead} дней`;
}

/** Send reminders for today's notable dates and advance reminders to all tribes. */
async function sendNotableDateReminders(bot: Telegraf): Promise<void> {
  const now = new Date();
  const mskDate = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const month = mskDate.getMonth() + 1;
  const day = mskDate.getDate();

  log.info(`Checking notable dates for ${day}.${month} + advance reminders`);

  // Get all tribes
  const { rows: tribes } = await query<{ id: number }>("SELECT id FROM tribes");

  for (const tribe of tribes) {
    try {
      const messages: string[] = [];

      // Today's dates
      const todayDates = await getDatesByMonthDay(tribe.id, month, day);
      if (todayDates.length > 0) {
        const todayMsg = formatDayReminders(todayDates);
        if (todayMsg) messages.push(todayMsg);
      }

      // Advance reminders (7, 3, 1 days ahead)
      for (const daysAhead of ADVANCE_DAYS) {
        const future = getMskFutureDate(daysAhead);
        const futureDates = await getDatesByMonthDay(tribe.id, future.month, future.day);

        // Only send advance reminders for priority dates
        const filteredDates = futureDates.filter((d) => d.isPriority);

        if (filteredDates.length > 0) {
          const prefix = formatAdvancePrefix(daysAhead);
          const dateLines = filteredDates.map((d) => `${d.emoji} ${d.name}`).join("\n");
          messages.push(`⏰ *${prefix}:*\n${dateLines}`);
        }
      }

      if (messages.length === 0) continue;

      const fullMessage = messages.join("\n\n");

      // Send to all tribe members (exclude seed users with invalid telegram_id)
      const users = (await listTribeUsers(tribe.id)).filter((u) => u.telegramId > 0);
      let sent = 0;
      for (const user of users) {
        try {
          await bot.telegram.sendMessage(user.telegramId, fullMessage, { parse_mode: "Markdown" });
          sent++;
        } catch (err) {
          log.error(`Failed to send notable date reminder to user ${user.telegramId}:`, err);
        }
      }

      log.info(`Tribe ${tribe.id}: sent ${sent}/${users.length} reminders (today: ${todayDates.length} dates)`);
    } catch (err) {
      log.error(`Error processing notable dates for tribe ${tribe.id}:`, err);
    }
  }
}
