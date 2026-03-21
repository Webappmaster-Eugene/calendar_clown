import { DEEPSEEK_MODEL } from "../constants.js";
import { callOpenRouterWithUsage } from "../utils/openRouterClient.js";

const SYSTEM_PROMPT =
  "Ты — полезный AI-ассистент. Отвечай на русском языке, если пользователь пишет по-русски. Будь кратким и по делу.";

export interface ChatCompletionResult {
  content: string;
  tokensUsed: number | null;
}

/** Send a chat completion request to OpenRouter. */
export async function chatCompletion(
  messages: Array<{ role: string; content: string }>
): Promise<ChatCompletionResult> {
  const fullMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  return callOpenRouterWithUsage({
    model: DEEPSEEK_MODEL,
    messages: fullMessages,
  });
}
