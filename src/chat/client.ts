import { OPENROUTER_URL, DEEPSEEK_MODEL, OPENROUTER_REFERER } from "../constants.js";

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
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const fullMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: fullMessages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Empty response from OpenRouter");
  }

  const tokensUsed = data?.usage?.total_tokens ?? null;

  return { content, tokensUsed };
}
