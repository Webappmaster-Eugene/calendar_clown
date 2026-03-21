/**
 * Extract gandalf entry data from voice transcript using OpenRouter (DeepSeek).
 * Used when bot is in gandalf mode.
 */

import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";

function buildGandalfSystemPrompt(categoriesList: string): string {
  return `You are a structured information tracker assistant. Extract entry information from the user's voice message.
Reply with ONLY a valid JSON object, no other text.

Available categories (exact names):
${categoriesList}

Today's date: ${new Date().toISOString().split("T")[0]}

Output format for creating an entry:
{"type":"gandalf_entry","category":"exact category name","title":"entry title/name","price":number_or_null,"nextDate":"ISO date or null","additionalInfo":"extra info or null","isImportant":boolean,"isUrgent":boolean}

Rules:
- "category" MUST be one of the exact category names from the list above
- "title" is REQUIRED — the name/description of the entry
- "price" is OPTIONAL — a number in rubles, null if not mentioned
- "nextDate" is OPTIONAL — ISO 8601 date string if a future date is mentioned, null otherwise
- "additionalInfo" is OPTIONAL — any extra details, null if none
- "isImportant" — set to true if the user says "важно", "важное", "отметь как важное" etc.
- "isUrgent" — set to true if the user says "срочно", "срочное", "горит", "нужно быстро" etc.
- If the user mentions a category not in the list, pick the closest match
- If you cannot determine title, return {"type":"partial","category":"name or null","title":null,"price":number_or_null,"isImportant":false,"isUrgent":false}
- If this is clearly NOT about tracking/recording something, return {"type":"not_gandalf"}
- If nothing is clear, return {"type":"unknown"}

Examples:
- "запиши в ЖКХ показания счётчика горячая вода 123" → {"type":"gandalf_entry","category":"ЖКХ","title":"Показания счётчика горячая вода 123","price":null,"nextDate":null,"additionalInfo":null,"isImportant":false,"isUrgent":false}
- "ремонт замена крана пять тысяч это важно" → {"type":"gandalf_entry","category":"Ремонт","title":"Замена крана","price":5000,"nextDate":null,"additionalInfo":null,"isImportant":true,"isUrgent":false}
- "здоровье анализ крови результат хороший следующий через полгода" → {"type":"gandalf_entry","category":"Здоровье","title":"Анализ крови","price":null,"nextDate":null,"additionalInfo":"Результат хороший, следующий через полгода","isImportant":false,"isUrgent":false}
- "срочно ремонт потёк кран" → {"type":"gandalf_entry","category":"Ремонт","title":"Потёк кран","price":null,"nextDate":null,"additionalInfo":null,"isImportant":false,"isUrgent":true}
- "что сегодня на ужин" → {"type":"not_gandalf"}`;
}

export interface GandalfVoiceResult {
  type: "gandalf_entry";
  category: string;
  title: string;
  price: number | null;
  nextDate: string | null;
  additionalInfo: string | null;
  isImportant: boolean;
  isUrgent: boolean;
}

export interface GandalfPartialResult {
  type: "partial";
  category: string | null;
  title: string | null;
  price: number | null;
  isImportant: boolean;
  isUrgent: boolean;
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
  const content = await callOpenRouter({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: buildGandalfSystemPrompt(categoriesList) },
      { role: "user", content: transcript },
    ],
  });
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
      isImportant: json.isImportant === true,
      isUrgent: json.isUrgent === true,
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

    return {
      type: "gandalf_entry", category, title, price, nextDate, additionalInfo,
      isImportant: json.isImportant === true,
      isUrgent: json.isUrgent === true,
    };
  }

  return { type: "unknown" };
}

