/**
 * AI-powered post summarization using DeepSeek via OpenRouter.
 */

import { OPENROUTER_URL, OPENROUTER_REFERER, DEEPSEEK_MODEL } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("digest");

const SUMMARIZE_PROMPT = `Ты — помощник для создания дайджеста телеграм-каналов.
Получаешь текст публикации из телеграм-канала.

Задача: написать краткое описание (summary) публикации на русском языке.

Правила:
- Длина: 1-3 предложения (не более 300 символов)
- Передай суть и ключевую информацию
- Не добавляй своё мнение
- Не начинай со слов "В публикации", "Автор" и т.п. — сразу суть
- Если текст слишком короткий или бессмысленный — верни пустую строку
- Выводи ТОЛЬКО текст summary, без кавычек и пояснений`;

/**
 * Summarize a single post text using DeepSeek.
 * Returns the summary string, or null on failure.
 */
export async function summarizePost(text: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.error("OPENROUTER_API_KEY not set, skipping summarization");
    return null;
  }

  // Truncate very long posts for the AI
  const truncated = text.length > 2000 ? text.slice(0, 2000) + "..." : text;

  try {
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
          { role: "system", content: SUMMARIZE_PROMPT },
          { role: "user", content: truncated },
        ],
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`Summarization API error: ${res.status} ${errText}`);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const summary = data?.choices?.[0]?.message?.content?.trim() ?? "";
    return summary || null;
  } catch (err) {
    log.error("Summarization failed:", err);
    return null;
  }
}

/**
 * Summarize multiple posts with rate limiting.
 * Returns an array of summaries in the same order as input texts.
 */
export async function summarizePosts(texts: string[]): Promise<Array<string | null>> {
  const results: Array<string | null> = [];
  for (let i = 0; i < texts.length; i++) {
    const summary = await summarizePost(texts[i]);
    results.push(summary);
    // Small delay between API calls
    if (i < texts.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return results;
}

/**
 * Use AI to generate an emoji and keywords for a rubric based on its name and description.
 * Returns { emoji, keywords }.
 */
export async function generateRubricMeta(
  name: string,
  description: string
): Promise<{ emoji: string; keywords: string[] }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { emoji: "📰", keywords: [] };
  }

  const prompt = `Ты помогаешь настроить рубрику для дайджеста телеграм-каналов.

Рубрика: "${name}"
Описание: "${description}"

Задача: верни JSON объект с двумя полями:
1. "emoji" — одна эмодзи-иконка, подходящая под тематику рубрики
2. "keywords" — массив из 5-10 ключевых слов/фраз на русском для поиска каналов по этой тематике

Верни ТОЛЬКО валидный JSON, без пояснений. Пример:
{"emoji":"💻","keywords":["программирование","разработка","код","IT","технологии"]}`;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
      }),
    });

    if (!res.ok) return { emoji: "📰", keywords: [] };

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { emoji?: string; keywords?: string[] };

    return {
      emoji: typeof parsed.emoji === "string" ? parsed.emoji : "📰",
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((k): k is string => typeof k === "string").slice(0, 10)
        : [],
    };
  } catch {
    return { emoji: "📰", keywords: [] };
  }
}
