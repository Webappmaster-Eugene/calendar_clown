/**
 * AI-powered expense text categorization using DeepSeek via OpenRouter.
 * Used as a fallback when fuzzy matching in parser.ts produces low-confidence results.
 * Mirrors the voice path (extractExpenseIntent.ts) but adapted for text input.
 */

import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import type { Category, ParsedExpense } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("expense-categorize-ai");

function buildCategorizePrompt(categoriesList: string): string {
  return `You are an expense categorization assistant. Parse the expense from the user's text message.
Reply with ONLY a valid JSON object, no other text.

Available categories (with aliases):
${categoriesList}

Output format:
{"category":"exact category name from list above","subcategory":"description or null","amount":number}

Rules:
- "category" MUST be one of the exact category names from the list above
- Match the user's description to the most appropriate category semantically
- "subcategory" is the descriptive part (what was bought/paid for), null if only category name given
- "amount" is a positive number in rubles
- If no category seems close, use "Другое"

Examples:
- "кофе 300" → {"category":"Кафе, доставка, фастфуд","subcategory":"Кофе","amount":300}
- "бензин 2500" → {"category":"Бензин и расходники на машину","subcategory":null,"amount":2500}
- "ашан 3500" → {"category":"Продукты","subcategory":"Ашан","amount":3500}
- "обед 500" → {"category":"Кафе, доставка, фастфуд","subcategory":"Обед","amount":500}
- "такси 800" → {"category":"Такси","subcategory":null,"amount":800}`;
}

/**
 * Categorize expense text using DeepSeek AI.
 * Returns ParsedExpense with resolved categoryId, or null if AI fails.
 */
export async function categorizeExpenseText(
  text: string,
  categories: Category[]
): Promise<ParsedExpense | null> {
  const categoriesList = categories
    .map((c) => {
      const aliasStr = c.aliases.length > 0
        ? ` (aliases: ${c.aliases.join(", ")})`
        : "";
      return `- ${c.name}${aliasStr}`;
    })
    .join("\n");

  let content: string | null;
  try {
    content = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: buildCategorizePrompt(categoriesList) },
        { role: "user", content: text },
      ],
    });
  } catch (err) {
    log.error("AI categorization request failed:", err);
    return null;
  }

  if (!content) return null;

  const json = tryParseJson(content);
  if (!json) {
    log.warn("AI categorization returned invalid JSON: %s", content);
    return null;
  }

  const categoryName = typeof json.category === "string" ? json.category.trim() : "";
  const amount = typeof json.amount === "number" ? json.amount : parseFloat(String(json.amount));
  const subcategory = typeof json.subcategory === "string" ? json.subcategory.trim() || null : null;

  if (!categoryName || isNaN(amount) || amount <= 0) {
    log.warn("AI categorization returned incomplete data: %o", json);
    return null;
  }

  // Resolve category name to ID (exact match → alias match → "Другое")
  const normalizedName = categoryName.toLowerCase();
  let cat = categories.find((c) => c.name.toLowerCase() === normalizedName);
  if (!cat) {
    cat = categories.find((c) =>
      c.aliases.some((a) => a.toLowerCase() === normalizedName)
    );
  }
  if (!cat) {
    cat = categories.find((c) => c.name === "Другое");
  }
  if (!cat) return null;

  return {
    categoryId: cat.id,
    categoryName: cat.name,
    categoryEmoji: cat.emoji,
    subcategory,
    amount,
  };
}
