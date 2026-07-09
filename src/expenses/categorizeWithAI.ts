/**
 * AI-powered expense text categorization using DeepSeek via OpenRouter.
 * Used as a fallback when fuzzy matching in parser.ts produces low-confidence results.
 * Mirrors the voice path (extractExpenseIntent.ts) but adapted for text input.
 */

import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import type { Category, ParsedExpense } from "./types.js";
import { formatCategoryForPrompt } from "./parser.js";
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
- ALWAYS choose the MOST SPECIFIC category that fits what was actually bought. Read each category's description to decide.
- "subcategory" is the descriptive part (what was bought/paid for), null if only category name given
- "amount" is a positive number in rubles
- "Другое" is a LAST RESORT only — use it ONLY when the expense genuinely fits no other category, never as a shortcut when unsure

Disambiguation:
- Маркетплейс — это КАНАЛ покупки, а не категория. Покупки на Ozon / Wildberries / WB классифицируй по СУТИ товара (продукты, детские товары, товары для дома, аптека и т.д.), а НЕ в общую категорию. "Подарки" — ТОЛЬКО если это подарок другому человеку.
- Ремонт/стройка/мебель/инструменты для КВАРТИРЫ или ДОМА → "Ремонт и обустройство квартиры". Ремонт МАШИНЫ/авто → "Ремонт машины и эксплуатация"
- Детские ВЕЩИ (одежда, игрушки, памперсы, коляска) → "Детские товары". Детский САД / СЕКЦИИ (услуги) → "Садик" или "Кружки и секции детей"
- Хозтовары / бытовая химия / посуда / фикс прайс → "Товары для дома". ЕДА и продукты питания → "Продукты"

Examples:
- "кофе 300" → {"category":"Кафе, доставка, фастфуд","subcategory":"Кофе","amount":300}
- "бензин 2500" → {"category":"Бензин и расходники на машину","subcategory":null,"amount":2500}
- "ашан 3500" → {"category":"Продукты","subcategory":"Ашан","amount":3500}
- "обед 500" → {"category":"Кафе, доставка, фастфуд","subcategory":"Обед","amount":500}
- "такси 800" → {"category":"Такси","subcategory":null,"amount":800}
- "стройматериалы 5000" → {"category":"Ремонт и обустройство квартиры","subcategory":"Стройматериалы","amount":5000}
- "детская одежда 2000" → {"category":"Детские товары","subcategory":"Одежда","amount":2000}
- "фикс прайс бытовая химия 800" → {"category":"Товары для дома","subcategory":"Бытовая химия","amount":800}
- "озон подгузники 1000" → {"category":"Детские товары","subcategory":"Подгузники","amount":1000}
- "подарок жене духи 3000" → {"category":"Подарки","subcategory":"Духи жене","amount":3000}`;
}

/**
 * Categorize expense text using DeepSeek AI.
 * Returns ParsedExpense with resolved categoryId, or null if AI fails.
 */
export async function categorizeExpenseText(
  text: string,
  categories: Category[]
): Promise<ParsedExpense | null> {
  const categoriesList = categories.map(formatCategoryForPrompt).join("\n");

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
