/**
 * Extract gandalf entry data from voice transcript using OpenRouter (DeepSeek).
 * Used when bot is in gandalf mode.
 */

import { OPENROUTER_URL, DEEPSEEK_MODEL, OPENROUTER_REFERER } from "../constants.js";

function buildGandalfSystemPrompt(categoriesList: string): string {
  return `You are a structured information tracker assistant. Extract entry information from the user's voice message.
Reply with ONLY a valid JSON object, no other text.

Available categories (exact names):
${categoriesList}

Today's date: ${new Date().toISOString().split("T")[0]}

Output format for creating an entry:
{"type":"gandalf_entry","category":"exact category name","title":"entry title/name","price":number_or_null,"nextDate":"ISO date or null","additionalInfo":"extra info or null"}

Rules:
- "category" MUST be one of the exact category names from the list above
- "title" is REQUIRED — the name/description of the entry
- "price" is OPTIONAL — a number in rubles, null if not mentioned
- "nextDate" is OPTIONAL — ISO 8601 date string if a future date is mentioned, null otherwise
- "additionalInfo" is OPTIONAL — any extra details, null if none
- If the user mentions a category not in the list, pick the closest match
- If you cannot determine title, return {"type":"partial","category":"name or null","title":null,"price":number_or_null}
- If this is clearly NOT about tracking/recording something, return {"type":"not_gandalf"}
- If nothing is clear, return {"type":"unknown"}

Examples:
- "запиши в ЖКХ показания счётчика горячая вода 123" → {"type":"gandalf_entry","category":"ЖКХ","title":"Показания счётчика горячая вода 123","price":null,"nextDate":null,"additionalInfo":null}
- "ремонт замена крана пять тысяч" → {"type":"gandalf_entry","category":"Ремонт","title":"Замена крана","price":5000,"nextDate":null,"additionalInfo":null}
- "здоровье анализ крови результат хороший следующий через полгода" → {"type":"gandalf_entry","category":"Здоровье","title":"Анализ крови","price":null,"nextDate":null,"additionalInfo":"Результат хороший, следующий через полгода"}
- "что сегодня на ужин" → {"type":"not_gandalf"}`;
}

export interface GandalfVoiceResult {
  type: "gandalf_entry";
  category: string;
  title: string;
  price: number | null;
  nextDate: string | null;
  additionalInfo: string | null;
}

export interface GandalfPartialResult {
  type: "partial";
  category: string | null;
  title: string | null;
  price: number | null;
}

export interface NotGandalfResult {
  type: "not_gandalf";
}

export interface UnknownResult {
  type: "unknown";
}

export type GandalfIntentResult = GandalfVoiceResult | GandalfPartialResult | NotGandalfResult | UnknownResult;

export async function extractGandalfIntent(
  transcript: string,
  categoriesList: string
): Promise<GandalfIntentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: buildGandalfSystemPrompt(categoriesList) },
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

  if (json.type === "not_gandalf") {
    return { type: "not_gandalf" };
  }

  if (json.type === "partial") {
    return {
      type: "partial",
      category: typeof json.category === "string" ? json.category.trim() : null,
      title: typeof json.title === "string" ? json.title.trim() : null,
      price: typeof json.price === "number" ? json.price : null,
    };
  }

  if (json.type === "gandalf_entry") {
    const category = typeof json.category === "string" ? json.category.trim() : "";
    const title = typeof json.title === "string" ? json.title.trim() : "";

    if (!category || !title) {
      return { type: "unknown" };
    }

    const price = typeof json.price === "number" ? json.price : null;
    const nextDate = typeof json.nextDate === "string" ? json.nextDate : null;
    const additionalInfo = typeof json.additionalInfo === "string" ? json.additionalInfo.trim() || null : null;

    return { type: "gandalf_entry", category, title, price, nextDate, additionalInfo };
  }

  return { type: "unknown" };
}

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
