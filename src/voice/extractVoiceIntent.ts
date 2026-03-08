/**
 * Single OpenRouter call: detect intent (calendar vs send_message) and extract fields.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3.1";
const TIMEZONE_MSK = "Europe/Moscow";

function nextWeekday(now: Date, targetDay: number): Date {
  const d = new Date(now);
  const current = d.getDay();
  let days = targetDay - current;
  if (days <= 0) days += 7;
  d.setDate(d.getDate() + days);
  return d;
}

function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });
  const year = now.getFullYear();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const nextTue = nextWeekday(now, 2);
  const tueStr = nextTue.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });

  return `Determine the user's intent from their message. Reply with ONLY a valid JSON object, no other text.

Options:

1) Creating a calendar meeting/event. Use type "calendar" for ANY phrase where the user asks to schedule, record, or create something AND mentions a date or time (explicit or from context). This includes:
   - Short: "встреча завтра в 15:00", "создай событие в понедельник в 10"
   - Rich context: "запиши меня к Роману на ремонт автомобиля во вторник в 10 утра", "встреча завтра, ремонт Романа автомобиль в 10 утра", "приём у врача в понедельник в 9"
   {"type":"calendar","title":"event title","start":"ISO8601","end":"ISO8601"}
   title: short descriptive title for the calendar event, preserving who and what (e.g. "Ремонт автомобиля у Романа", "Запись к Роману: ремонт авто"). Do not reduce to a single word.
   Timezone: Europe/Moscow (UTC+3). Always use +03:00 in start/end (e.g. ${year}-03-09T10:00:00+03:00).
   Today is ${dateStr} (${weekday}). Use year ${year}. No date → today. No time → 10:00. Default duration 1 hour.
   Examples:
   - "Запиши меня к Роману на ремонт автомобиля во вторник в 10 утра" → {"type":"calendar","title":"Ремонт автомобиля у Романа","start":"${tueStr}T10:00:00+03:00","end":"${tueStr}T11:00:00+03:00"}
   - "Встреча завтра, ремонт Романа автомобиль в 10 утра" → {"type":"calendar","title":"Ремонт автомобиля у Романа","start":"${tomorrowStr}T10:00:00+03:00","end":"${tomorrowStr}T11:00:00+03:00"}
   - "Встреча завтра в 15:00" → {"type":"calendar","title":"Встреча","start":"${tomorrowStr}T15:00:00+03:00","end":"${tomorrowStr}T16:00:00+03:00"}

2) Sending a message to someone (e.g. "отправь Анжелике Надточеевой что я ее люблю", "напиши Ивану что завтра встреча"):
   {"type":"send_message","recipient":"recipient name or username","text":"exact message text to send"}
   recipient: full name (e.g. "Анжелика Надточеева") or Telegram username without @. Use nominative for name.
   text: the exact text the user wants to send to that person.

3) Anything else or unclear:
   {"type":"unknown"}`;
}

export type VoiceIntent =
  | { type: "calendar"; title: string; start: Date; end: Date }
  | { type: "send_message"; recipient: string; text: string }
  | { type: "unknown" };

function tryParseJson(raw: string): Record<string, unknown> | null {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function extractVoiceIntent(transcript: string): Promise<VoiceIntent> {
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
  if (!content) return { type: "unknown" };

  const json = tryParseJson(content);
  if (!json || typeof json.type !== "string") return { type: "unknown" };

  if (json.type === "send_message") {
    const recipient = typeof json.recipient === "string" ? json.recipient.trim() : "";
    const text = typeof json.text === "string" ? json.text : "";
    if (recipient && text !== undefined) {
      return { type: "send_message", recipient, text };
    }
  }

  if (json.type === "calendar") {
    const title = typeof json.title === "string" ? json.title.trim() : "";
    const startStr = typeof json.start === "string" ? json.start : "";
    const endStr = typeof json.end === "string" ? json.end : "";
    if (title && startStr && endStr) {
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        return { type: "calendar", title, start, end };
      }
    }
  }

  return { type: "unknown" };
}
