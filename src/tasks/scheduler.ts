/**
 * Task Tracker scheduler: checks for pending task reminders every minute
 * and sends notifications via Telegram.
 */

import { Cron } from "croner";
import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { getPendingTaskReminders, markTaskReminderSent } from "./repository.js";
import { formatReminderType, formatTaskDeadlineFull } from "./logic.js";
import type { TaskReminderType } from "./logic.js";
import { escapeMarkdown } from "../utils/markdown.js";

const log = createLogger("tasks-scheduler");
let tasksCron: Cron | null = null;

export function startTasksScheduler(bot: Telegraf): void {
  const expr = process.env.TASKS_CRON ?? "* * * * *";
  tasksCron = new Cron(expr, { timezone: "Europe/Moscow" }, async () => {
    try {
      await processTaskReminders(bot);
    } catch (err) {
      log.error("Tasks scheduler error:", err instanceof Error ? err.message : err);
    }
  });
  log.info(`Tasks scheduler started: "${expr}" (Europe/Moscow)`);
}

export function stopTasksScheduler(): void {
  if (tasksCron) {
    tasksCron.stop();
    tasksCron = null;
    log.info("Tasks scheduler stopped.");
  }
}

async function processTaskReminders(bot: Telegraf): Promise<void> {
  const now = new Date();
  const pending = await getPendingTaskReminders(now);
  if (pending.length === 0) return;

  let sent = 0;
  for (const reminder of pending) {
    try {
      const deadlineFormatted = formatTaskDeadlineFull(reminder.deadline);
      const typeText = formatReminderType(reminder.reminderType as TaskReminderType);
      const safeName = escapeMarkdown(reminder.workName);
      const safeText = escapeMarkdown(reminder.taskText);

      const message =
        `${reminder.workEmoji} *Напоминание о задаче* (${typeText})\n\n` +
        `Проект: *${safeName}*\n` +
        `Задача: ${safeText}\n` +
        `Дедлайн: ${deadlineFormatted}\n\n` +
        `Используйте /tasks чтобы посмотреть свои задачи.`;

      await bot.telegram.sendMessage(reminder.telegramId, message, {
        parse_mode: "Markdown",
      });
      await markTaskReminderSent(reminder.reminderId);
      sent++;
    } catch (err) {
      log.error(
        `Failed to send task reminder ${reminder.reminderId} to user ${reminder.telegramId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (sent > 0) {
    log.info(`Sent ${sent} task reminder(s).`);
  }
}
