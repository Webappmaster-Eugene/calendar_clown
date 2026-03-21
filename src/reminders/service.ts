/**
 * Pure business logic for Reminders: schedule evaluation, formatting, validation.
 * No DB or API calls.
 */

import { TIMEZONE_MSK } from "../constants.js";
import type { ReminderSchedule } from "./types.js";

const WEEKDAY_NAMES_RU: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
};

/**
 * Check if a reminder should fire right now.
 * All comparisons in Europe/Moscow timezone.
 */
export function shouldFireNow(
  schedule: ReminderSchedule,
  now: Date,
  lastFiredAt: Date | null
): boolean {
  const mskNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE_MSK }));
  const currentHH = String(mskNow.getHours()).padStart(2, "0");
  const currentMM = String(mskNow.getMinutes()).padStart(2, "0");
  const currentTime = `${currentHH}:${currentMM}`;

  // Check endDate
  if (schedule.endDate) {
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
    if (todayStr > schedule.endDate) {
      return false;
    }
  }

  // Check weekday (ISO-8601: 1=Mon..7=Sun)
  const jsDay = mskNow.getDay(); // 0=Sun..6=Sat
  const isoDay = jsDay === 0 ? 7 : jsDay;
  if (!schedule.weekdays.includes(isoDay)) {
    return false;
  }

  // Check time
  if (!schedule.times.includes(currentTime)) {
    return false;
  }

  // Anti-duplicate: check if already fired in this minute
  if (lastFiredAt) {
    const mskLast = new Date(lastFiredAt.toLocaleString("en-US", { timeZone: TIMEZONE_MSK }));
    if (
      mskLast.getFullYear() === mskNow.getFullYear() &&
      mskLast.getMonth() === mskNow.getMonth() &&
      mskLast.getDate() === mskNow.getDate() &&
      mskLast.getHours() === mskNow.getHours() &&
      mskLast.getMinutes() === mskNow.getMinutes()
    ) {
      return false;
    }
  }

  return true;
}

/** Check if endDate has passed (should deactivate). */
export function isExpired(schedule: ReminderSchedule, now: Date): boolean {
  if (!schedule.endDate) return false;
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  return todayStr > schedule.endDate;
}

/** Format schedule as human-readable description. */
export function formatScheduleDescription(schedule: ReminderSchedule): string {
  const parts: string[] = [];

  // Days
  const allWeekdays = [1, 2, 3, 4, 5];
  const allDays = [1, 2, 3, 4, 5, 6, 7];
  const sorted = [...schedule.weekdays].sort((a, b) => a - b);

  if (sorted.length === 7) {
    parts.push("Каждый день");
  } else if (
    sorted.length === 5 &&
    allWeekdays.every((d) => sorted.includes(d))
  ) {
    parts.push("Пн-Пт");
  } else if (
    sorted.length === 2 &&
    sorted.includes(6) &&
    sorted.includes(7)
  ) {
    parts.push("Сб-Вс");
  } else {
    parts.push(sorted.map((d) => WEEKDAY_NAMES_RU[d] ?? String(d)).join(", "));
  }

  // Times
  const sortedTimes = [...schedule.times].sort();
  parts.push("в " + sortedTimes.join(", "));

  return parts.join(" ");
}

/** Format end date for display. */
export function formatEndDate(endDate: string | null): string {
  if (!endDate) return "бессрочно";
  const d = new Date(endDate + "T00:00:00+03:00");
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIMEZONE_MSK,
  });
}

/** Validate a ReminderSchedule. Returns error message or null if valid. */
export function validateSchedule(schedule: ReminderSchedule): string | null {
  if (!Array.isArray(schedule.times) || schedule.times.length === 0) {
    return "Укажите хотя бы одно время.";
  }

  if (schedule.times.length > 10) {
    return "Максимум 10 времён в одном напоминании.";
  }

  const timeRegex = /^\d{2}:\d{2}$/;
  for (const t of schedule.times) {
    if (!timeRegex.test(t)) {
      return `Неверный формат времени: ${t}. Ожидается HH:MM.`;
    }
    const [hh, mm] = t.split(":").map(Number);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return `Неверное время: ${t}.`;
    }
  }

  if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0) {
    return "Укажите хотя бы один день недели.";
  }

  for (const d of schedule.weekdays) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      return `Неверный день недели: ${d}. Ожидается 1-7 (Пн-Вс).`;
    }
  }

  if (schedule.endDate) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(schedule.endDate)) {
      return `Неверный формат даты окончания: ${schedule.endDate}. Ожидается YYYY-MM-DD.`;
    }
    const parsed = new Date(schedule.endDate + "T00:00:00+03:00");
    if (Number.isNaN(parsed.getTime())) {
      return `Неверная дата окончания: ${schedule.endDate}.`;
    }
  }

  return null;
}

/** Format reminder notification message. */
export function formatReminderMessage(text: string, schedule: ReminderSchedule): string {
  const scheduleDesc = formatScheduleDescription(schedule);
  const endDateDesc = schedule.endDate ? `\n📆 До: ${formatEndDate(schedule.endDate)}` : "";
  return `🔔 *Напоминание*\n\n${text}\n\n📅 ${scheduleDesc}${endDateDesc}`;
}
