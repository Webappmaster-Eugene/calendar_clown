import { callOpenRouter } from "../utils/openRouterClient.js";
import { tavilySearch } from "../osint/searchClient.js";
import { BLOGGER_MODEL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { BloggerChannel, BloggerPost, BloggerSource } from "./repository.js";
import type { TavilyResult } from "../osint/types.js";

const log = createLogger("blogger-gen");

/** Generate a Telegram post from channel info, topic, and sources. */
export async function generatePost(
  channel: BloggerChannel,
  post: BloggerPost,
  sources: BloggerSource[]
): Promise<string> {
  const nicheInfo = channel.nicheDescription
    ? `НИША КАНАЛА: ${channel.nicheDescription}. Все примеры, аналогии и рекомендации должны быть релевантны этой нише.`
    : "";

  const sourcesText = sources.map((s, i) => {
    const typeLabel: Record<string, string> = {
      text: "Заметка",
      voice: "Голосовая заметка",
      link: "Статья",
      forward: "Пересланное сообщение",
      web_search: "Результат поиска",
    };
    const label = typeLabel[s.sourceType] || "Источник";
    const titlePart = s.title ? ` (${s.title})` : "";
    const content = s.parsedContent || s.content;
    return `--- Источник ${i + 1}: ${label}${titlePart} ---\n${content}`;
  }).join("\n\n");

  const systemPrompt = `Ты — харизматичный автор популярного Telegram-канала. Ты пишешь живые, глубокие, развёрнутые посты, которые цепляют с первой строки и держат внимание до конца.

КОНТЕКСТ: Сейчас 2026 год, Россия. Все примеры, аналогии и контекст — из российских реалий. Не ссылайся на устаревшие данные (до 2025 года).

${nicheInfo}

КРИТИЧЕСКИ ВАЖНО — ОБЪЁМ:
- Целевой объём: 8000–12000 символов (2-3 сообщения Telegram Premium)
- МИНИМУМ 6000 символов. Если получается короче — добавляй анализ, примеры, истории, контекст
- Каждый тезис раскрывай подробно: не просто утверждай — объясняй ПОЧЕМУ, приводи аналогии, цифры, реальные кейсы
- Используй ВСЮ информацию из источников. Не сокращай и не выбрасывай факты — интегрируй их в нарратив
- Лучше больше деталей, чем меньше. Читатель пришёл за глубиной

СТИЛЬ И ПОДАЧА:
- Пиши как автор популярного Telegram-канала, а НЕ как корпоративный бот или новостная лента
- Начинай с мощного хука: провокационный вопрос, шокирующий факт, контринтуитивный тезис, личная история
- Используй storytelling: конкретные ситуации, "представьте", диалоги, сценарии из жизни
- Чередуй короткие ёмкие абзацы (1-2 предложения) с развёрнутыми блоками анализа
- Высказывай авторское мнение — не будь нейтральным и отстранённым
- Используй обращение к читателю ("вы", "ваш", "знаете что..."), риторические вопросы
- Добавляй эмоциональные акценты, но без перебора
- Заканчивай сильным выводом, инсайтом или провокационным вопросом — не банальным "подписывайтесь"

СТРУКТУРА:
- Цепляющий заголовок с эмодзи
- Хук в первых 2-3 строках (зачем это читать)
- Основной контент: тезис → развёрнутое объяснение → пример/кейс → вывод
- Подзаголовки с эмодзи для навигации
- Финальный блок: сильный вывод + вопрос для комментариев

РАЗМЕТКА Telegram:
- <b>жирный</b> для ключевых мыслей и акцентов
- <i>курсив</i> для цитат и второстепенных акцентов
- Эмодзи для подзаголовков и визуальных маркеров (•, —)
- НЕ использовать <code> без необходимости

ЗАПРЕЩЕНО (шаблонные AI-фразы):
- "В мире где...", "Давайте разберёмся", "Важно отметить", "Стоит подчеркнуть"
- "В заключение хочется сказать", "Подводя итоги", "Резюмируя"
- "Не секрет что", "Как известно", "Эксперты отмечают", "Очевидно что"
- "Безусловно", "Несомненно", "Бесспорно"
- "Время покажет", "Будущее за...", "Следите за обновлениями"
- Перечисления без анализа ("во-первых, во-вторых, в-третьих")
- Пустые обобщения без конкретики`;

  const styleSamplesBlock = channel.styleSamples
    ? `\n\nПРИМЕРЫ СТИЛЯ КАНАЛА (перенимай манеру, тон, структуру и подачу):\n${
        (JSON.parse(channel.styleSamples) as string[])
          .map((s: string, i: number) => `--- Пример стиля ${i + 1} ---\n${s}`)
          .join("\n\n")
      }`
    : "";

  const userPrompt = `Тема поста: ${post.topic}

ЗАДАНИЕ: Напиши развёрнутый пост (8000-12000 символов) для Telegram-канала "${channel.channelTitle}".
Используй ВСЕ факты и данные из источников — не выбрасывай, а интегрируй в нарратив.
Добавь свой анализ, неочевидные связи и практические выводы.

Источники:
${sourcesText}${styleSamplesBlock}`;

  log.info(`Generating post for channel "${channel.channelTitle}", topic: "${post.topic}", sources: ${sources.length}`);

  const result = await callOpenRouter({
    model: BLOGGER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.75,
    max_tokens: 8192,
  });

  if (!result) {
    throw new Error("AI вернул пустой ответ");
  }

  log.info(`Generated post: ${result.length} chars`);
  return result;
}

/** Split long text into Telegram-safe message chunks (~4096 chars max). */
export function splitIntoMessages(text: string): string[] {
  const MAX_MSG_LEN = 4000; // slightly under 4096 for safety
  if (text.length <= MAX_MSG_LEN) return [text];

  const messages: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LEN) {
      messages.push(remaining);
      break;
    }

    // Find a good split point — prefer double newline, then single newline
    let splitAt = remaining.lastIndexOf("\n\n", MAX_MSG_LEN);
    if (splitAt < MAX_MSG_LEN * 0.5) {
      splitAt = remaining.lastIndexOf("\n", MAX_MSG_LEN);
    }
    if (splitAt < MAX_MSG_LEN * 0.3) {
      splitAt = MAX_MSG_LEN;
    }

    messages.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return messages;
}

/** Search the web for a topic using Tavily. Returns results for use as sources. */
export async function searchForTopic(topic: string): Promise<TavilyResult[]> {
  try {
    const searchResult = await tavilySearch(topic, 5);
    return searchResult.results;
  } catch (err) {
    log.error("Tavily search failed for topic:", err);
    return [];
  }
}
