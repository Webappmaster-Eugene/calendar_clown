/**
 * DeepSeek extraction for reminder intents from voice transcripts.
 * Returns structured JSON: create_reminder, delete_reminder, list_reminders, or unknown.
 */

import { DEEPSEEK_MODEL, TIMEZONE_MSK } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import type { ReminderSchedule } from "../reminders/types.js";

export type ReminderIntent =
  | { type: "create_reminder"; text: string; schedule: ReminderSchedule }
  | { type: "delete_reminder"; query: string }
  | { type: "list_reminders" }
  | { type: "unknown" };

function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });

  return `You are a reminder extraction assistant. The user speaks in Russian. Determine the intent and extract structured data. Reply with ONLY a valid JSON object.

Current date: ${dateStr} (${weekday}), timezone: Europe/Moscow.

Options:

1) Creating a reminder. User says "напомни", "напоминай", "напоминание" + text + schedule.
   Return:
   {"type":"create_reminder","text":"reminder text","schedule":{"times":["HH:MM",...],"weekdays":[1,2,...],"endDate":"YYYY-MM-DD" or null}}

   Rules:
   - times: array of HH:MM strings in 24h format (Moscow time). Always zero-pad: "09:00" not "9:00".
   - weekdays: ISO-8601 day numbers: 1=Monday, 2=Tuesday, ..., 7=Sunday.
   - endDate: YYYY-MM-DD or null if no end date mentioned.
   - text: the reminder message itself (what to remind about), short and clear.

   Schedule interpretation:
   - "каждый день" → weekdays: [1,2,3,4,5,6,7]
   - "каждый будний день" / "кроме субботы и воскресенья" / "по будням" → weekdays: [1,2,3,4,5]
   - "по выходным" → weekdays: [6,7]
   - "каждый понедельник" → weekdays: [1]
   - "по понедельникам и средам" → weekdays: [1,3]
   - "до августа 2026" → endDate: "2026-08-01"
   - "до конца года" → endDate: "2026-12-31" (end of current year)
   - No end date → endDate: null
   - If no weekdays specified, default to every day: [1,2,3,4,5,6,7]
   - "в 10", "в десять" → times: ["10:00"]
   - "в 10 и в 18:30" → times: ["10:00","18:30"]
   - "утром" → times: ["09:00"], "вечером" → times: ["19:00"]

   Examples:
   - "напомни мне сегодня в 10, 13:35 и в 18:30 чтобы я проверил почту. Делай это каждый день кроме субботы и воскресенья до августа 2026 года"
     → {"type":"create_reminder","text":"Проверить почту","schedule":{"times":["10:00","13:35","18:30"],"weekdays":[1,2,3,4,5],"endDate":"2026-08-01"}}
   - "напоминай каждый день в 8 утра принять лекарства"
     → {"type":"create_reminder","text":"Принять лекарства","schedule":{"times":["08:00"],"weekdays":[1,2,3,4,5,6,7],"endDate":null}}
   - "каждую пятницу в 17 напоминай про отчёт"
     → {"type":"create_reminder","text":"Отчёт","schedule":{"times":["17:00"],"weekdays":[5],"endDate":null}}

2) Deleting/cancelling a reminder. User says "удали напоминание", "отмени напоминание", "убери напоминание" + keywords.
   Return: {"type":"delete_reminder","query":"search keywords"}

3) Listing reminders. User says "мои напоминания", "покажи напоминания", "список напоминаний".
   Return: {"type":"list_reminders"}

4) Anything else or unclear:
   Return: {"type":"unknown"}`;
}

export async function extractReminderIntent(transcript: string): Promise<ReminderIntent> {
  const content = await callOpenRouter({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: transcript },
    ],
  });
  if (!content) return { type: "unknown" };

  const json = tryParseJson(content);
  if (!json || typeof json.type !== "string") return { type: "unknown" };

  if (json.type === "list_reminders") {
    return { type: "list_reminders" };
  }

  if (json.type === "delete_reminder") {
    const query = typeof json.query === "string" ? json.query.trim() : "";
    return { type: "delete_reminder", query };
  }

  if (json.type === "create_reminder") {
    const text = typeof json.text === "string" ? json.text.trim() : "";
    if (!text) return { type: "unknown" };

    const rawSchedule = json.schedule as Record<string, unknown> | undefined;
    if (!rawSchedule || typeof rawSchedule !== "object") return { type: "unknown" };

    const times = Array.isArray(rawSchedule.times)
      ? (rawSchedule.times as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    const weekdays = Array.isArray(rawSchedule.weekdays)
      ? (rawSchedule.weekdays as unknown[]).filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7)
      : [];
    const endDate = typeof rawSchedule.endDate === "string" ? rawSchedule.endDate : null;

    if (times.length === 0 || weekdays.length === 0) return { type: "unknown" };

    // Normalize times to HH:MM
    const normalizedTimes = times.map((t) => {
      const parts = t.split(":");
      if (parts.length === 2) {
        return parts[0].padStart(2, "0") + ":" + parts[1].padStart(2, "0");
      }
      return t;
    });

    const schedule: ReminderSchedule = {
      times: normalizedTimes,
      weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
      endDate,
    };

    return { type: "create_reminder", text, schedule };
  }

  return { type: "unknown" };
}
