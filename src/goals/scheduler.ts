/**
 * Cron scheduler for goal reminders.
 * Checks pending reminders every hour and sends progress messages.
 */

import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { getPendingReminders, markReminderSent, getGoalSetProgress } from "./repository.js";
import { formatProgress } from "./service.js";

const log = createLogger("goals-scheduler");

let goalsCron: Cron | null = null;

/** Start the goals reminder scheduler. */
export function startGoalsScheduler(bot: Telegraf): void {
  const expr = process.env.GOALS_CRON ?? "0 */1 * * *";

  goalsCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    log.info("Goals reminder cron triggered");
    await sendGoalReminders(bot);
  });

  log.info(`Goals scheduler started: "${expr}" (Europe/Moscow)`);
}

/** Stop the scheduler. */
export function stopGoalsScheduler(): void {
  if (goalsCron) {
    goalsCron.stop();
    goalsCron = null;
    log.info("Goals scheduler stopped.");
  }
}

/** Check pending reminders and send progress messages. */
async function sendGoalReminders(bot: Telegraf): Promise<void> {
  const now = new Date();
  const pending = await getPendingReminders(now);

  if (pending.length === 0) return;

  log.info(`Processing ${pending.length} pending goal reminders`);

  for (const reminder of pending) {
    try {
      const progress = await getGoalSetProgress(reminder.goalSetId);
      const progressBar = formatProgress(progress.completed, progress.total);

      const message =
        `${reminder.goalSetEmoji} *Напоминание о целях*\n\n` +
        `Набор: *${reminder.goalSetName}*\n` +
        `Прогресс: ${progressBar}\n\n` +
        `Используйте /goals чтобы посмотреть свои цели.`;

      await bot.telegram.sendMessage(reminder.telegramId, message, { parse_mode: "Markdown" });
      await markReminderSent(reminder.reminderId);

      log.info(`Sent goal reminder ${reminder.reminderId} to user ${reminder.telegramId}`);
    } catch (err) {
      log.error(`Failed to send goal reminder ${reminder.reminderId}:`, err);
    }
  }
}
