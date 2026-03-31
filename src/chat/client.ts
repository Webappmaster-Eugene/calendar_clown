import { DEEPSEEK_MODEL } from "../constants.js";
import {
  callOpenRouter,
  callOpenRouterWithUsage,
  callOpenRouterStream,
  type MessageContent,
  type StreamResult,
} from "../utils/openRouterClient.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("chat-client");

/** Check if error is a model-not-found (404) error from OpenRouter. */
function isModelNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    (msg.includes("request failed: 404") || msg.includes("No endpoints found")) &&
    msg.includes("OpenRouter")
  );
}

/** Check if the model is a free-tier model (has :free suffix). */
function isFreeModel(model: string): boolean {
  return model.endsWith(":free");
}

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

/** Send a chat completion request to OpenRouter. Falls back to paid model if free model is unavailable. */
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

  const requestedModel = model ?? DEEPSEEK_MODEL;

  try {
    return await callOpenRouterWithUsage({
      model: requestedModel,
      messages: fullMessages,
    });
  } catch (err) {
    if (isFreeModel(requestedModel) && isModelNotFoundError(err)) {
      log.warn(`Free model "${requestedModel}" unavailable, falling back to "${DEEPSEEK_MODEL}"`);
      return callOpenRouterWithUsage({
        model: DEEPSEEK_MODEL,
        messages: fullMessages,
      });
    }
    throw err;
  }
}

/**
 * Send a streaming chat completion request.
 * Calls onChunk for each content delta.
 * Returns the full accumulated result when done.
 * Falls back to paid model if free model is unavailable.
 */
export async function chatCompletionStream(
  messages: Array<{ role: string; content: MessageContent }>,
  onChunk: (text: string) => void | Promise<void>,
  model?: string,
  systemPromptOverride?: string
): Promise<StreamResult> {
  const systemPrompt = systemPromptOverride ?? buildSystemPrompt();
  const fullMessages: Array<{ role: string; content: MessageContent }> = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const requestedModel = model ?? DEEPSEEK_MODEL;

  try {
    return await callOpenRouterStream(
      { model: requestedModel, messages: fullMessages },
      onChunk
    );
  } catch (err) {
    if (isFreeModel(requestedModel) && isModelNotFoundError(err)) {
      log.warn(`Free model "${requestedModel}" unavailable (stream), falling back to "${DEEPSEEK_MODEL}"`);
      return callOpenRouterStream(
        { model: DEEPSEEK_MODEL, messages: fullMessages },
        onChunk
      );
    }
    throw err;
  }
}

/** Generate a short title (3-5 words) for a dialog based on the first message. */
export async function generateDialogTitle(firstMessage: string, model?: string): Promise<string> {
  const requestedModel = model ?? DEEPSEEK_MODEL;
  const titleMessages = [
    {
      role: "system",
      content: "Придумай короткий заголовок (3-5 слов) для диалога на основе первого сообщения пользователя. Ответь ТОЛЬКО заголовком, без кавычек и пунктуации.",
    },
    { role: "user", content: firstMessage },
  ];

  let result: string | null;
  try {
    result = await callOpenRouter({
      model: requestedModel,
      messages: titleMessages,
      max_tokens: 50,
      temperature: 0.7,
    });
  } catch (err) {
    if (isFreeModel(requestedModel) && isModelNotFoundError(err)) {
      log.warn(`Free model "${requestedModel}" unavailable (title gen), falling back to "${DEEPSEEK_MODEL}"`);
      result = await callOpenRouter({
        model: DEEPSEEK_MODEL,
        messages: titleMessages,
        max_tokens: 50,
        temperature: 0.7,
      });
    } else {
      throw err;
    }
  }

  if (!result) {
    log.error("Failed to generate dialog title: empty response");
    return "Новый диалог";
  }

  // Trim and limit to 200 chars
  return result.trim().slice(0, 200);
}
