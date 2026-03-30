/**
 * Core AI food analysis function.
 * Calls OpenRouter (Gemini vision model) to analyze food photos.
 */
import { callOpenRouter } from "../utils/openRouterClient.js";
import { NUTRITIONIST_VISION_MODEL } from "../constants.js";
import { tryParseJson } from "../utils/parseJson.js";
import type { ContentPart } from "../utils/openRouterClient.js";

// ─── Types ──────────────────────────────────────────────────────

export interface FoodItem {
  name: string;
  weight_g: number;
  calories: number;
  proteins_g: number;
  fats_g: number;
  carbs_g: number;
  cooking_method: string;
}

export interface NutritionResult {
  items: FoodItem[];
  total: {
    weight_g: number;
    calories: number;
    proteins_g: number;
    fats_g: number;
    carbs_g: number;
  };
  dish_type: string;
  meal_assessment: string;
  confidence: "high" | "medium" | "low";
}

// ─── Prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — профессиональный нутрициолог-диетолог с 15-летним опытом. Твоя задача — точно анализировать фотографии еды.

АНАЛИЗ ИЗОБРАЖЕНИЯ:
1. Определи ВСЕ продукты и блюда на фото, включая гарниры, соусы, напитки, хлеб, приправы
2. Определи способ приготовления каждого продукта (варёный, жареный, тушёный, запечённый, сырой, гриль, на пару, фритюр)
3. Оцени вес каждого продукта в граммах, ориентируясь на:
   - Размер тарелки (стандартная обеденная тарелка ~24-26 см, суповая ~20 см, десертная ~19 см)
   - Глубину наполнения посуды
   - Толщину и площадь кусков мяса/рыбы
   - Объём гарнира относительно тарелки (половина тарелки ≈ 150-200г для каши/пюре)
   - Стандартные порции: столовая ложка крупы ≈ 25г, кусок хлеба ≈ 30-40г, котлета ≈ 80-120г
4. Рассчитай калории и БЖУ по каждому продукту и суммарно

ОЦЕНКА УВЕРЕННОСТИ:
- "high" — чёткое фото, стандартная порция в обычной посуде, легко узнаваемые блюда
- "medium" — нечёткое фото, нестандартная посуда, частично скрытые продукты, смешанные блюда
- "low" — плохое качество, непонятный ракурс, экзотическое блюдо, невозможно оценить объём

ОСОБЕННОСТИ:
- Учитывай русскую и СНГ кухню: борщ, пельмени, оливье, шарлотка, блины, сырники и т.д.
- Жареное на масле добавляет ~50 ккал на порцию, фритюр ещё больше
- Соусы (майонез, кетчуп, сметана) содержат значительные калории — не игнорируй их
- Если видишь несколько тарелок — анализируй содержимое каждой
- Напитки (сок, компот, чай с сахаром) тоже учитывай если видно
- Если не удаётся точно определить блюдо — укажи наиболее вероятный вариант

ОЦЕНКА ПРИЁМА ПИЩИ:
Дай краткую оценку (2-3 предложения): сбалансированность БЖУ, достаточность белка, избыток/недостаток чего-либо, рекомендации.

Ответь СТРОГО в формате JSON без markdown-обёртки, без текста до и после JSON:
{
  "items": [
    {
      "name": "Название продукта/блюда",
      "weight_g": 150,
      "calories": 165,
      "proteins_g": 31,
      "fats_g": 3.6,
      "carbs_g": 0,
      "cooking_method": "гриль"
    }
  ],
  "total": {
    "weight_g": 450,
    "calories": 460,
    "proteins_g": 37.9,
    "fats_g": 4.7,
    "carbs_g": 63
  },
  "dish_type": "Обед",
  "meal_assessment": "Сбалансированный обед с хорошим содержанием белка...",
  "confidence": "high"
}

Если на фото НЕ еда — верни:
{
  "items": [],
  "total": {"weight_g": 0, "calories": 0, "proteins_g": 0, "fats_g": 0, "carbs_g": 0},
  "dish_type": "Не определено",
  "meal_assessment": "На фотографии не обнаружена еда. Пожалуйста, отправьте фото с едой для анализа.",
  "confidence": "low"
}`;

// ─── Analysis Function ─────────────────────────────────────────

/**
 * Analyze a food photo via Gemini vision model.
 * @param imageBase64 - Base64-encoded image data
 * @param mimeType - Image MIME type (e.g., "image/jpeg", "image/heic")
 * @param caption - Optional user caption for context
 * @returns Structured nutrition result and model name
 */
export async function analyzeFood(
  imageBase64: string,
  mimeType: string,
  caption?: string,
): Promise<{ result: NutritionResult; model: string }> {
  const model = NUTRITIONIST_VISION_MODEL;

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const userText = caption?.trim()
    ? `Проанализируй еду на фото. Контекст от пользователя: ${caption}`
    : "Проанализируй еду на фото.";

  const userContent: ContentPart[] = [
    { type: "image_url", image_url: { url: dataUrl } },
    { type: "text", text: userText },
  ];

  const raw = await callOpenRouter({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  });

  if (!raw) {
    throw new Error("Пустой ответ от AI");
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    throw new Error("Не удалось разобрать ответ AI как JSON");
  }

  const result = validateNutritionResult(parsed);
  return { result, model };
}

// ─── JSON Extraction ────────────────────────────────────────────

/** Extract JSON from AI response, handling various markdown wrapping styles. */
function extractJson(raw: string): Record<string, unknown> | null {
  // 1. Try tryParseJson first (handles ```json ... ``` wrapper)
  const direct = tryParseJson(raw);
  if (direct) return direct;

  // 2. Try stripping plain ``` wrapper (without "json" label)
  const plainFence = raw.replace(/^```\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try {
    return JSON.parse(plainFence) as Record<string, unknown>;
  } catch { /* continue */ }

  // 3. Try extracting first JSON object from the text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch { /* continue */ }
  }

  return null;
}

// ─── Validation ─────────────────────────────────────────────────

function validateNutritionResult(data: Record<string, unknown>): NutritionResult {
  const items = Array.isArray(data.items) ? data.items : [];
  const total = (data.total as Record<string, unknown>) ?? {};

  const validatedItems: FoodItem[] = items.map((item: Record<string, unknown>) => ({
    name: String(item.name ?? "Неизвестный продукт"),
    weight_g: Number(item.weight_g) || 0,
    calories: Number(item.calories) || 0,
    proteins_g: Number(item.proteins_g) || 0,
    fats_g: Number(item.fats_g) || 0,
    carbs_g: Number(item.carbs_g) || 0,
    cooking_method: String(item.cooking_method ?? "—"),
  }));

  const validatedTotal = {
    weight_g: Number(total.weight_g) || 0,
    calories: Number(total.calories) || 0,
    proteins_g: Number(total.proteins_g) || 0,
    fats_g: Number(total.fats_g) || 0,
    carbs_g: Number(total.carbs_g) || 0,
  };

  const confidence = data.confidence;
  const validConfidence: NutritionResult["confidence"] =
    confidence === "high" || confidence === "medium" || confidence === "low"
      ? confidence
      : "medium";

  return {
    items: validatedItems,
    total: validatedTotal,
    dish_type: String(data.dish_type ?? "Не определено"),
    meal_assessment: String(data.meal_assessment ?? ""),
    confidence: validConfidence,
  };
}
