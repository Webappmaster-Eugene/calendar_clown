import { OPENROUTER_URL, OPENROUTER_REFERER } from "../constants.js";

/** Send a chat completion request to OpenRouter and return the text content, or null. */
export async function callOpenRouter(options: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
}): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
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

  return data?.choices?.[0]?.message?.content?.trim() ?? null;
}

/** Variant that also returns usage info (for chat client). */
export async function callOpenRouterWithUsage(options: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
}): Promise<{ content: string; tokensUsed: number | null }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
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
