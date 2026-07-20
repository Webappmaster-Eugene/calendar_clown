import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { getDatesByMonthDay } from "./repository.js";
import { formatDayReminders } from "./service.js";
import { listTribeUsers } from "../expenses/repository.js";
import { db } from "../db/drizzle.js";
import { tribes } from "../db/schema.js";

const log = createLogger("notable-dates");

let notableDatesCron: Cron | null = null;

const ADVANCE_DAYS = [7, 3, 1] as const;

export function startNotableDatesScheduler(bot: Telegraf): void {
  const expr = process.env.NOTABLE_DATES_CRON ?? "0 10,17 * * *";

  notableDatesCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    log.info("Notable dates cron triggered");
    await sendNotableDateReminders(bot);
  });

  log.info(`Notable dates scheduler started: "${expr}" (Europe/Moscow)`);
}

export function stopNotableDatesScheduler(): void {
  if (notableDatesCron) {
    notableDatesCron.stop();
    notableDatesCron = null;
    log.info("Notable dates scheduler stopped.");
  }
}

function getMskFutureDate(daysAhead: number): { month: number; day: number } {
  const now = new Date();
  // Calendar-day arithmetic on the MSK date; millisecond addition on UTC time
  // would only give the right date when the server timezone is UTC.
  const mskNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const mskFuture = new Date(mskNow.getFullYear(), mskNow.getMonth(), mskNow.getDate() + daysAhead);
  return { month: mskFuture.getMonth() + 1, day: mskFuture.getDate() };
}

function formatAdvancePrefix(daysAhead: number): string {
  if (daysAhead === 1) return "Завтра";
  if (daysAhead === 3) return "Через 3 дня";
  if (daysAhead === 7) return "Через 7 дней";
  return `Через ${daysAhead} дней`;
}

async function sendNotableDateReminders(bot: Telegraf): Promise<void> {
  const now = new Date();
  const mskDate = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const month = mskDate.getMonth() + 1;
  const day = mskDate.getDate();

  log.info(`Checking notable dates for ${day}.${month} + advance reminders`);

  const tribeRows = await db.select({ id: tribes.id }).from(tribes);

  for (const tribe of tribeRows) {
    try {
      const messages: string[] = [];

      const todayDates = await getDatesByMonthDay(tribe.id, month, day);
      if (todayDates.length > 0) {
        const todayMsg = formatDayReminders(todayDates);
        if (todayMsg) messages.push(todayMsg);
      }

      for (const daysAhead of ADVANCE_DAYS) {
        const future = getMskFutureDate(daysAhead);
        const futureDates = await getDatesByMonthDay(tribe.id, future.month, future.day);

        // Advance reminders only fire for priority dates.
        const filteredDates = futureDates.filter((d) => d.isPriority);

        if (filteredDates.length > 0) {
          const prefix = formatAdvancePrefix(daysAhead);
          const dateLines = filteredDates.map((d) => `${d.emoji} ${d.name}`).join("\n");
          messages.push(`⏰ *${prefix}:*\n${dateLines}`);
        }
      }

      if (messages.length === 0) continue;

      const fullMessage = messages.join("\n\n");

      // Exclude seed users whose telegram_id is invalid (<= 0).
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

      logAction(null, null, "scheduler_notable_dates_reminder", {
        tribeId: tribe.id,
        sentCount: sent,
        usersTotal: users.length,
        todayDatesCount: todayDates.length,
      });
      log.info(`Tribe ${tribe.id}: sent ${sent}/${users.length} reminders (today: ${todayDates.length} dates)`);
    } catch (err) {
      log.error(`Error processing notable dates for tribe ${tribe.id}:`, err);
    }
  }
}
