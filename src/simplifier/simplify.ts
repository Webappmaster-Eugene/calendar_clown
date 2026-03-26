/**
 * Core AI simplification function.
 * Calls OpenRouter (DeepSeek) to clean up messy text.
 */
import { callOpenRouter } from "../utils/openRouterClient.js";
import { SIMPLIFIER_MODEL } from "../constants.js";

const SYSTEM_PROMPT = `Ты — профессиональный редактор деловых текстов. Задача — очистить текст, сохранив объём и смысл.

Правила:
1. Удали слова-паразиты: "ну", "типа", "как бы", "э", "вот", "так сказать", "короче", "в общем", "собственно", "значит", "получается", "скажем так", "да?", "вот так вот", "то есть"
2. Удали повторения и дублирующиеся мысли
3. Удали междометия и звуковые наполнители
4. Исправь грамматику, синтаксис и пунктуацию
5. Сохрани оригинальный смысл и объём — не сокращай содержание, не добавляй новых мыслей
6. Форматируй для читабельности: абзацы, нумерованные списки где уместно
7. Пиши на том же языке, что и входной текст

Выведи ТОЛЬКО очищенный текст, без пояснений.`;

/**
 * Simplify the given text via AI.
 * @returns The simplified text and model name used.
 */
export async function simplifyText(
  text: string,
): Promise<{ result: string; model: string }> {
  const model = SIMPLIFIER_MODEL;

  const result = await callOpenRouter({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    temperature: 0.3,
  });

  if (!result) {
    throw new Error("Пустой ответ от AI");
  }

  return { result, model };
}
