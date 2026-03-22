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
    ? `Ниша канала: ${channel.nicheDescription}`
    : "Ниша канала не указана";

  const sourcesText = sources.map((s, i) => {
    const typeLabel = {
      text: "Заметка",
      voice: "Голосовая заметка",
      link: "Статья",
      forward: "Пересланное сообщение",
      web_search: "Результат поиска",
    }[s.sourceType] || "Источник";
    const titlePart = s.title ? ` (${s.title})` : "";
    const content = s.parsedContent || s.content;
    return `--- Источник ${i + 1}: ${typeLabel}${titlePart} ---\n${content}`;
  }).join("\n\n");

  const systemPrompt = `Ты — эксперт-автор Telegram-каналов. Пиши глубокие, аналитические посты, которые выходят за рамки исходных материалов.

Правила:
- Писать на языке источников (default: русский)
- Использовать Telegram-разметку: <b>жирный</b>, <i>курсив</i>, <code>моно</code>
- Добавлять собственный анализ и неочевидные выводы
- Максимум ~12000 символов (3 Telegram-сообщения)
- НЕ использовать шаблонные AI-фразы ("в мире где...", "давайте разберёмся...")
- Писать как эксперт с конкретными примерами
- Структурировать текст с подзаголовками
- ${nicheInfo}`;

  const userPrompt = `Тема поста: ${post.topic}\n\nИсточники:\n${sourcesText}`;

  const result = await callOpenRouter({
    model: BLOGGER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  if (!result) {
    throw new Error("AI вернул пустой ответ");
  }

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
    const results = await tavilySearch(topic, 5);
    return results;
  } catch (err) {
    log.error("Tavily search failed for topic:", err);
    return [];
  }
}
