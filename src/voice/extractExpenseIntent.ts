/**
 * Extract expense data from voice transcript using OpenRouter (DeepSeek).
 * Used when bot is in expense mode.
 */

import { DEEPSEEK_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { createLogger } from "../utils/logger.js";
import { INSTRUCTION_GUARD, wrapUserContent } from "./promptSafety.js";

const log = createLogger("extract-expense-intent");

function buildExpenseSystemPrompt(categoriesList: string): string {
  return `You are an expense tracking assistant. Extract expense information from the user's voice message.
Reply with ONLY a valid JSON object, no other text.

Available categories (with aliases):
${categoriesList}

Output format:
{"type":"expense","category":"exact category name from list above","subcategory":"description or null","amount":number}

Rules:
- "category" MUST be one of the exact category names from the list above
- If the user mentions a word matching an alias, use that alias's category name
- "subcategory" is optional description text (what exactly was bought/paid for), null if not mentioned
- "amount" is a positive number in rubles. Parse spoken numbers: "пять тысяч" = 5000, "двести" = 200, "полторы тысячи" = 1500
- ALWAYS choose the MOST SPECIFIC category that fits what was actually bought. Read each category's description to decide.
- "Другое" is a LAST RESORT only — use it ONLY when the expense genuinely fits no other category. Never use it as a shortcut when unsure; instead pick the closest specific category.
- Only return {"type":"unknown"} if there is absolutely no amount mentioned AND the message is not about spending money
- Only return {"type":"not_expense"} if the message is clearly about something completely unrelated to expenses (e.g. scheduling a meeting, asking a question)
- When in doubt between "unknown" and "expense", prefer "expense" and pick the closest specific category (NOT automatically "Другое")

Disambiguation:
- Маркетплейс — это КАНАЛ покупки, а не категория. Покупки на Ozon / Wildberries / WB классифицируй по СУТИ товара (продукты, детские товары, товары для дома, аптека и т.д.), а НЕ в общую категорию. "Подарки" — ТОЛЬКО если это подарок другому человеку.
- Ремонт/стройка/мебель/инструменты для КВАРТИРЫ или ДОМА → "Ремонт и обустройство квартиры". Ремонт МАШИНЫ/авто → "Ремонт машины и эксплуатация"
- Детские ВЕЩИ (одежда, игрушки, памперсы, коляска) → "Детские товары". Детский САД / СЕКЦИИ (услуги) → "Садик" или "Кружки и секции детей"
- Хозтовары / бытовая химия / посуда / фикс прайс → "Товары для дома". ЕДА и продукты питания → "Продукты"
- Косметика / уход / парфюм / макияж → "Товары для красоты". Стрижка / маникюр / эпиляция / массаж (услуга) → "Услуги (стрижка, эпиляция)"
- Одежда и обувь ВЗРОСЛЫМ → "Одежда и обувь". Детская одежда → "Детские товары"

Examples:
- "аптека геморрой пять тысяч" → {"type":"expense","category":"Аптека","subcategory":"Геморрой","amount":5000}
- "продукты три тысячи двести" → {"type":"expense","category":"Продукты","subcategory":null,"amount":3200}
- "кафе бургер кинг тысяча двести" → {"type":"expense","category":"Кафе, доставка, фастфуд","subcategory":"Бургер Кинг","amount":1200}
- "заправил машину две тысячи" → {"type":"expense","category":"Бензин и расходники на машину","subcategory":null,"amount":2000}
- "массаж три тысячи" → {"type":"expense","category":"Услуги (стрижка, эпиляция)","subcategory":"Массаж","amount":3000}
- "кроссовки пять тысяч" → {"type":"expense","category":"Одежда и обувь","subcategory":"Кроссовки","amount":5000}
- "косметика тысяча двести" → {"type":"expense","category":"Товары для красоты","subcategory":null,"amount":1200}
- "родителям на лекарства две тысячи" → {"type":"expense","category":"Помощь родителям","subcategory":"Лекарства","amount":2000}
- "налоговая пять тысяч" → {"type":"expense","category":"Налоги","subcategory":null,"amount":5000}
- "штраф гибдд пятьсот" → {"type":"expense","category":"Налоги","subcategory":"Штраф ГИБДД","amount":500}
- "рассада на дачу пятьсот" → {"type":"expense","category":"Дача","subcategory":"Рассада","amount":500}
- "такси пятьсот рублей" → {"type":"expense","category":"Такси","subcategory":null,"amount":500}
- "обед пятьсот" → {"type":"expense","category":"Кафе, доставка, фастфуд","subcategory":"Обед","amount":500}
- "стройматериалы пять тысяч" → {"type":"expense","category":"Ремонт и обустройство квартиры","subcategory":"Стройматериалы","amount":5000}
- "детская одежда две тысячи" → {"type":"expense","category":"Детские товары","subcategory":"Одежда","amount":2000}
- "фикс прайс средства для уборки полторы тысячи" → {"type":"expense","category":"Товары для дома","subcategory":"Средства для уборки","amount":1500}
- "озон подгузники тысяча" → {"type":"expense","category":"Детские товары","subcategory":"Подгузники","amount":1000}
- "вайлдберриз бытовая химия пятьсот" → {"type":"expense","category":"Товары для дома","subcategory":"Бытовая химия","amount":500}
- "подарок жене духи три тысячи" → {"type":"expense","category":"Подарки","subcategory":"Духи жене","amount":3000}
- "заплатил за что-то непонятное две тысячи" → {"type":"expense","category":"Другое","subcategory":null,"amount":2000}`;
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
      { role: "system", content: `${buildExpenseSystemPrompt(categoriesList)}\n\n${INSTRUCTION_GUARD}` },
      { role: "user", content: wrapUserContent(transcript) },
    ],
  });
  if (!content) {
    log.warn("Empty response from DeepSeek for transcript: %j", transcript);
    return { type: "unknown" };
  }

  const json = tryParseJson(content);
  if (!json || typeof json.type !== "string") {
    log.warn("Unparseable DeepSeek response (transcript=%j, raw=%j)", transcript, content);
    return { type: "unknown" };
  }

  if (json.type === "not_expense") {
    log.info("Voice marked as not_expense (transcript=%j)", transcript);
    return { type: "not_expense" };
  }

  if (json.type === "expense") {
    const category = typeof json.category === "string" ? json.category.trim() : "";
    const subcategory = typeof json.subcategory === "string" ? json.subcategory.trim() || null : null;
    const amount = typeof json.amount === "number" ? json.amount : parseFloat(String(json.amount));

    if (!category || isNaN(amount) || amount <= 0) {
      log.warn("Incomplete expense intent (transcript=%j, category=%j, amount=%j)", transcript, category, amount);
      return { type: "unknown" };
    }

    return { type: "expense", category, subcategory, amount };
  }

  log.warn("Unknown intent type %j (transcript=%j)", json.type, transcript);
  return { type: "unknown" };
}

