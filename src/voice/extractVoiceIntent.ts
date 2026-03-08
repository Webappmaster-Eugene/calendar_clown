/**
 * Single OpenRouter call: detect intent (calendar vs send_message) and extract fields.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3.1";
const TIMEZONE_MSK = "Europe/Moscow";

function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE_MSK });
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: TIMEZONE_MSK });
  const year = now.getFullYear();

  return `Determine the user's intent from their message. Reply with ONLY a valid JSON object, no other text.

Options:

1) Creating a calendar meeting/event (e.g. "встреча завтра в 15:00", "создай событие в понедельник в 10"):
   {"type":"calendar","title":"event title","start":"ISO8601","end":"ISO8601"}
   Timezone: Europe/Moscow (UTC+3). Use +03:00 in start/end (e.g. ${year}-03-09T10:00:00+03:00).
   Today is ${dateStr} (${weekday}). Use year ${year}. No date → today. No time → 10:00. Default duration 1 hour.

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
    const title = typeof json.title === "string" ? json.title : "";
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
