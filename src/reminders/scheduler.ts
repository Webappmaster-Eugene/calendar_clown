/**
 * Cron scheduler for reminders.
 * Runs every minute, checks all active reminders, sends matching ones.
 */

import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { getActiveRemindersWithUsers, updateLastFiredAt, deactivateReminder, getSubscribers } from "./repository.js";
import { shouldFireNow, isExpired } from "./service.js";

const log = createLogger("reminders-scheduler");

let remindersCron: Cron | null = null;

/** Start the reminders scheduler (every minute). */
export function startRemindersScheduler(bot: Telegraf): void {
  const expr = process.env.REMINDERS_CRON ?? "* * * * *";

  remindersCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    await processReminders(bot);
  });

  log.info(`Reminders scheduler started: "${expr}" (Europe/Moscow)`);
}

/** Stop the scheduler. */
export function stopRemindersScheduler(): void {
  if (remindersCron) {
    remindersCron.stop();
    remindersCron = null;
    log.info("Reminders scheduler stopped.");
  }
}

/** Check all active reminders and send matching ones. */
async function processReminders(bot: Telegraf): Promise<void> {
  let reminders;
  try {
    reminders = await getActiveRemindersWithUsers();
  } catch (err) {
    log.error("Failed to fetch active reminders:", err);
    return;
  }

  if (reminders.length === 0) return;

  const now = new Date();

  for (const reminder of reminders) {
    try {
      // Check if expired → deactivate
      if (isExpired(reminder.schedule, now)) {
        await deactivateReminder(reminder.id);
        log.info(`Deactivated expired reminder ${reminder.id}`);
        continue;
      }

      if (!shouldFireNow(reminder.schedule, now, reminder.lastFiredAt)) {
        continue;
      }

      const message = `🔔 *Напоминание*\n\n${reminder.text}`;

      // Send to owner
      try {
        await bot.telegram.sendMessage(reminder.telegramId, message, { parse_mode: "Markdown" });
      } catch (sendErr) {
        log.error(`Failed to send reminder ${reminder.id} to owner ${reminder.telegramId}:`, sendErr);
      }

      // Send to subscribers
      try {
        const subscribers = await getSubscribers(reminder.id);
        for (const sub of subscribers) {
          if (sub.subscriberTelegramId) {
            try {
              await bot.telegram.sendMessage(sub.subscriberTelegramId, message, { parse_mode: "Markdown" });
            } catch (subErr) {
              log.error(`Failed to send reminder ${reminder.id} to subscriber ${sub.subscriberTelegramId}:`, subErr);
            }
          }
        }
      } catch (subErr) {
        log.error(`Failed to get subscribers for reminder ${reminder.id}:`, subErr);
      }

      // Update last_fired_at
      await updateLastFiredAt(reminder.id);

      logAction(null, reminder.telegramId, "scheduler_reminders_fire", {
        reminderId: reminder.id,
        telegramId: reminder.telegramId,
      });
      log.info(`Fired reminder ${reminder.id} to user ${reminder.telegramId}`);
    } catch (err) {
      log.error(`Error processing reminder ${reminder.id}:`, err);
    }
  }
}
