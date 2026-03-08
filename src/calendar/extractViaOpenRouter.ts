/**
 * Extract one calendar event from transcript using OpenRouter (DeepSeek).
 * Single-task context only: voice → event JSON. No general chat, to keep cost and latency low.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3.1";

/** Minimal system prompt: this bot has exactly one job — extract one calendar event into JSON. */
const CALENDAR_EXTRACT_CONTEXT = `Task: from the user message extract exactly one calendar event.
Output: only a valid JSON object, no other text.
Format: {"title":"event title","start":"ISO8601","end":"ISO8601"}
Timezone: Europe/Moscow. No date → today. No time → 10:00. Default duration: 1 hour.
Example: {"title":"Meeting","start":"2025-03-09T15:00:00+03:00","end":"2025-03-09T16:00:00+03:00"}`;

export interface ExtractedEvent {
  title: string;
  start: Date;
  end: Date;
}

export async function extractCalendarEvent(
  transcript: string
): Promise<ExtractedEvent | null> {
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
        { role: "system", content: CALENDAR_EXTRACT_CONTEXT },
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
  if (!content) return null;

  const json = tryParseJson(content);
  if (
    !json ||
    typeof json.title !== "string" ||
    typeof json.start !== "string" ||
    typeof json.end !== "string"
  ) {
    return null;
  }

  const start = new Date(json.start);
  const end = new Date(json.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return { title: json.title, start, end };
}

function tryParseJson(
  raw: string
): { title?: string; start?: string; end?: string } | null {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as {
      title?: string;
      start?: string;
      end?: string;
    };
  } catch {
    return null;
  }
}
