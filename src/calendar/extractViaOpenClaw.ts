/**
 * Extract calendar event (title, start, end) from natural language using OpenClaw Gateway Chat Completions.
 */

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";

const SYSTEM_PROMPT = `You extract exactly one calendar event from the user's message. Reply with ONLY a valid JSON object, no other text:
{"title": "event title", "start": "ISO8601 datetime", "end": "ISO8601 datetime"}
- Timezone: Europe/Moscow.
- If no date is given, use today's date. If no time is given, use 10:00. Default duration 1 hour.
- start and end must be full ISO 8601 strings (e.g. 2025-03-09T15:00:00+03:00).`;

export interface ExtractedEvent {
  title: string;
  start: Date;
  end: Date;
}

export async function extractCalendarEvent(
  transcript: string
): Promise<ExtractedEvent | null> {
  const baseUrl = (process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN is not set");
  }

  const url = `${baseUrl}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-openclaw-agent-id": "main",
    },
    body: JSON.stringify({
      model: "openclaw",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenClaw request failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const json = tryParseJson(content);
  if (!json || typeof json.title !== "string" || typeof json.start !== "string" || typeof json.end !== "string") {
    return null;
  }

  const start = new Date(json.start);
  const end = new Date(json.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return { title: json.title, start, end };
}

function tryParseJson(raw: string): { title?: string; start?: string; end?: string } | null {
  const stripped = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped) as { title?: string; start?: string; end?: string };
  } catch {
    return null;
  }
}
