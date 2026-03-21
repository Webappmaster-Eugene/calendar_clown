/**
 * Extract expense data from voice transcript using OpenRouter (DeepSeek).
 * Used when bot is in expense mode.
 */

import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";

function buildExpenseSystemPrompt(categoriesList: string): string {
  return `You are an expense tracking assistant. Extract expense information from the user's voice message.
Reply with ONLY a valid JSON object, no other text.

Available categories (exact names):
${categoriesList}

Output format:
{"type":"expense","category":"exact category name from list above","subcategory":"description or null","amount":number}

Rules:
- "category" MUST be one of the exact category names from the list above
- "subcategory" is optional description text (what exactly was bought/paid for), null if not mentioned
- "amount" is a positive number in rubles
- If the user mentions a category not in the list, pick the closest match
- If amount is not mentioned, return {"type":"unknown"}
- If this is clearly NOT about expenses (e.g. scheduling a meeting), return {"type":"not_expense"}

Examples:
- "аптека геморрой пять тысяч" → {"type":"expense","category":"Аптека","subcategory":"Геморрой","amount":5000}
- "продукты три тысячи двести" → {"type":"expense","category":"Продукты","subcategory":null,"amount":3200}
- "кафе бургер кинг тысяча двести" → {"type":"expense","category":"Кафе, доставка, фастфуд","subcategory":"Бургер Кинг","amount":1200}
- "заправил машину две тысячи" → {"type":"expense","category":"Бензин и расходники на машину","subcategory":null,"amount":2000}
- "массаж три тысячи" → {"type":"expense","category":"Массаж","subcategory":null,"amount":3000}
- "такси пятьсот рублей" → {"type":"expense","category":"Такси","subcategory":null,"amount":500}`;
}

export interface ExpenseVoiceResult {
  type: "expense";
  category: string;
  subcategory: string | null;
  amount: number;
}

export interface NotExpenseResult {
  type: "not_expense";
}

export interface UnknownResult {
  type: "unknown";
}

export type ExpenseIntentResult = ExpenseVoiceResult | NotExpenseResult | UnknownResult;

export async function extractExpenseIntent(
  transcript: string,
  categoriesList: string
): Promise<ExpenseIntentResult> {
  const content = await callOpenRouter({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: buildExpenseSystemPrompt(categoriesList) },
      { role: "user", content: transcript },
    ],
  });
  if (!content) return { type: "unknown" };

  const json = tryParseJson(content);
  if (!json || typeof json.type !== "string") return { type: "unknown" };

  if (json.type === "not_expense") {
    return { type: "not_expense" };
  }

  if (json.type === "expense") {
    const category = typeof json.category === "string" ? json.category.trim() : "";
    const subcategory = typeof json.subcategory === "string" ? json.subcategory.trim() || null : null;
    const amount = typeof json.amount === "number" ? json.amount : parseFloat(String(json.amount));

    if (!category || isNaN(amount) || amount <= 0) {
      return { type: "unknown" };
    }

    return { type: "expense", category, subcategory, amount };
  }

  return { type: "unknown" };
}

