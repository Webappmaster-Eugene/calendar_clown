import { DEEPSEEK_MODEL } from "../constants.js";
import { callOpenRouter, callOpenRouterWithUsage, type MessageContent } from "../utils/openRouterClient.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("chat-client");

/** Build system prompt with current date. */
export function buildSystemPrompt(): string {
  const date = new Date().toLocaleDateString("ru-RU", { dateStyle: "long" });
  return `Ты — экспертный AI-ассистент с глубокими знаниями в самых разных областях.
Текущая дата: ${date}.

Правила ответа:
1. Структура: сначала дай точный, конкретный ответ на вопрос → затем подробное объяснение с примерами и нюансами → в конце блок "📖 Почему именно так" с обоснованием.
2. Качество: никогда не придумывай факты. Если не уверен — скажи об этом. Если есть результаты веб-поиска — опирайся на них и указывай источники.
3. Полнота: раскрывай все аспекты вопроса, приводи примеры, описывай нюансы и исключения.
4. Если в сообщении есть блок "--- Результаты веб-поиска ---" — используй эти данные как основу ответа, ссылайся на источники в формате [название](url).
5. Если в сообщении есть блок "--- Содержимое ссылок ---" — проанализируй предоставленный контент и ответь на основе него.
6. Отвечай на русском языке, если пользователь пишет по-русски.
7. Используй Markdown для форматирования: заголовки, списки, жирный текст, блоки кода.`;
}

export interface ChatCompletionResult {
  content: string;
  tokensUsed: number | null;
}

/** Send a chat completion request to OpenRouter. */
export async function chatCompletion(
  messages: Array<{ role: string; content: MessageContent }>,
  model?: string,
  systemPromptOverride?: string
): Promise<ChatCompletionResult> {
  const systemPrompt = systemPromptOverride ?? buildSystemPrompt();
  const fullMessages: Array<{ role: string; content: MessageContent }> = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  return callOpenRouterWithUsage({
    model: model ?? DEEPSEEK_MODEL,
    messages: fullMessages,
  });
}

/** Generate a short title (3-5 words) for a dialog based on the first message. */
export async function generateDialogTitle(firstMessage: string): Promise<string> {
  const result = await callOpenRouter({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: "system",
        content: "Придумай короткий заголовок (3-5 слов) для диалога на основе первого сообщения пользователя. Ответь ТОЛЬКО заголовком, без кавычек и пунктуации.",
      },
      { role: "user", content: firstMessage },
    ],
    max_tokens: 50,
    temperature: 0.7,
  });

  if (!result) {
    log.error("Failed to generate dialog title: empty response");
    return "Новый диалог";
  }

  // Trim and limit to 200 chars
  return result.trim().slice(0, 200);
}
