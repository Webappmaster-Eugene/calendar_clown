/**
 * Core AI simplification function.
 * Calls OpenRouter (DeepSeek) to clean up messy text.
 */
import { callOpenRouter } from "../utils/openRouterClient.js";
import { SIMPLIFIER_MODEL } from "../constants.js";

const SYSTEM_PROMPT = `Ты — редактор расшифрованной речи. Задача — очистить текст от артефактов распознавания речи, сохранив ВСЁ содержание.

Это НЕ сокращение и НЕ резюмирование — сохрани весь смысл и объём текста.

Правила:
1. Удали слова-паразиты: "ну", "типа", "как бы", "э", "вот", "так сказать", "короче", "в общем", "собственно", "значит", "получается", "скажем так", "да?", "вот так вот"
2. Удали ДОСЛОВНЫЕ повторения (одинаковые фразы подряд от сбоя распознавания). НЕ удаляй перефразирования — когда автор объясняет мысль другими словами, это важная информация
3. Удали междометия и звуковые наполнители
4. Исправь грамматику, синтаксис и пунктуацию
5. Сохрани технические термины, имена собственные, иностранные слова (особенно IT-термины) в оригинальном виде
6. Форматируй для читабельности: абзацы, нумерованные списки где уместно
7. Пиши на том же языке, что и входной текст. Если текст содержит смесь русского и английского — сохрани оба

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
