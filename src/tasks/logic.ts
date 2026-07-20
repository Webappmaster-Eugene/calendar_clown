import { TIMEZONE_MSK } from "../shared/constants.js";

export type TaskReminderType = "day_before" | "4h_before" | "1h_before";

/**
 * Skips reminders whose remind_at is already in the past.
 * day_before: deadline date minus 1 day, at 09:00 MSK; 4h_before / 1h_before: deadline minus 4h / 1h.
 */
export function calculateTaskReminders(
  deadline: Date,
  now: Date = new Date(),
): Array<{ remindAt: Date; reminderType: TaskReminderType }> {
  const results: Array<{ remindAt: Date; reminderType: TaskReminderType }> = [];
  const nowMs = now.getTime();

  const dayBefore = getDayBeforeAt0900Msk(deadline);
  if (dayBefore.getTime() > nowMs) {
    results.push({ remindAt: dayBefore, reminderType: "day_before" });
  }

  const fourHBefore = new Date(deadline.getTime() - 4 * 60 * 60 * 1000);
  if (fourHBefore.getTime() > nowMs) {
    results.push({ remindAt: fourHBefore, reminderType: "4h_before" });
  }

  const oneHBefore = new Date(deadline.getTime() - 60 * 60 * 1000);
  if (oneHBefore.getTime() > nowMs) {
    results.push({ remindAt: oneHBefore, reminderType: "1h_before" });
  }

  return results;
}

/**
 * 09:00 MSK on (deadline_date - 1 day). Uses Intl.DateTimeFormat so the MSK
 * date is correct regardless of server timezone.
 */
function getDayBeforeAt0900Msk(deadline: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE_MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(deadline);
  const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);

  // MSK = UTC+3, so 09:00 MSK = 06:00 UTC
  const utcDate = new Date(Date.UTC(year, month - 1, day - 1, 6, 0, 0, 0));
  return utcDate;
}

export function formatTaskDeadlineFull(deadline: Date): string {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIMEZONE_MSK,
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(deadline);
}

export function formatReminderType(type: TaskReminderType): string {
  switch (type) {
    case "day_before": return "за 1 день";
    case "4h_before": return "за 4 часа";
    case "1h_before": return "за 1 час";
  }
}

export function isOverdue(deadline: Date, now: Date = new Date()): boolean {
  return deadline.getTime() < now.getTime();
}
