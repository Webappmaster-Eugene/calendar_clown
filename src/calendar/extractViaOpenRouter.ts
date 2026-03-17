/**
 * Extract one calendar event from transcript using OpenRouter (DeepSeek).
 * Single-task context only: voice → event JSON. No general chat, to keep cost and latency low.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3.1";
const TIMEZONE_MSK = "Europe/Moscow";

/** Build system prompt with current date so the model uses the correct year (no past dates). */
function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK }); // YYYY-MM-DD
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });
  const year = now.getFullYear();
  return `Task: from the user message extract one or more calendar events.
Output: only a valid JSON, no other text.
If one event: {"title":"event title","start":"ISO8601","end":"ISO8601"} or with optional "recurrence":["RRULE:..."] for repeating events.
If multiple events: {"events":[{"title":"...","start":"...","end":"..."},{"title":"...","start":"...","end":"..."}]}
Recurring: if the user says "каждую пятницу", "каждую неделю", "еженедельно", "по понедельникам" etc., add "recurrence":["RRULE:FREQ=WEEKLY;BYDAY=XX"] where XX is MO,TU,WE,TH,FR,SA,SU. Set start/end to the first occurrence.
Timezone: Europe/Moscow (UTC+3). Always use +03:00 in start/end (e.g. ${year}-03-09T10:00:00+03:00).
IMPORTANT: Today is ${dateStr} (${weekday}), ${TIMEZONE_MSK}. Always use the current year (${year}) when the user does not specify a year. "Tomorrow", "next Monday", "today" must refer to dates in ${year} or later. No date → today. No time → 10:00. Default duration: 1 hour.
Example: {"title":"Meeting","start":"${year}-03-09T15:00:00+03:00","end":"${year}-03-09T16:00:00+03:00"}
Example recurring: {"title":"Массаж","start":"...","end":"...","recurrence":["RRULE:FREQ=WEEKLY;BYDAY=FR"]}`;
}

export interface ExtractedEvent {
  title: string;
  start: Date;
  end: Date;
  recurrence?: string[];
}

/** Extract one or more calendar events from transcript. */
export async function extractCalendarEvents(
  transcript: string
): Promise<ExtractedEvent[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/telegram-google-calendar-bot",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return [];

  const json = tryParseJson(content);
  if (!json) return [];

  // Support both single event and array of events
  const rawEvents: Array<Record<string, unknown>> = [];
  if (Array.isArray(json.events)) {
    rawEvents.push(...(json.events as Array<Record<string, unknown>>));
  } else if (typeof json.title === "string") {
    rawEvents.push(json as Record<string, unknown>);
  }

  const results: ExtractedEvent[] = [];
  for (const ev of rawEvents) {
    if (typeof ev.title !== "string" || typeof ev.start !== "string" || typeof ev.end !== "string") continue;
    const start = new Date(ev.start as string);
    const end = new Date(ev.end as string);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    let recurrence: string[] | undefined;
    if (Array.isArray(ev.recurrence) && ev.recurrence.every((r): r is string => typeof r === "string") && ev.recurrence.length > 0) {
      recurrence = ev.recurrence;
    }

    results.push({ title: ev.title as string, start, end, recurrence });
  }

  return results;
}

/** Extract exactly one calendar event (backwards-compat wrapper). */
export async function extractCalendarEvent(
  transcript: string
): Promise<ExtractedEvent | null> {
  const events = await extractCalendarEvents(transcript);
  return events.length > 0 ? events[0] : null;
}

function tryParseJson(
  raw: string
): { title?: string; start?: string; end?: string; recurrence?: unknown; events?: unknown[] } | null {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as {
      title?: string;
      start?: string;
      end?: string;
      recurrence?: unknown;
      events?: unknown[];
    };
  } catch {
    return null;
  }
}
