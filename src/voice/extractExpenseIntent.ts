/**
 * Extract expense data from voice transcript using OpenRouter (DeepSeek).
 * Used when bot is in expense mode.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3.1";

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
        { role: "system", content: buildExpenseSystemPrompt(categoriesList) },
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
