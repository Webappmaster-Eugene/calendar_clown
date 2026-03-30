import { OPENROUTER_URL, OPENROUTER_REFERER } from "../constants.js";

/** Content part for multimodal messages (text + images). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Message content: plain string or multimodal array. */
export type MessageContent = string | ContentPart[];

/** Send a chat completion request to OpenRouter and return the text content, or null. */
export async function callOpenRouter(options: {
  model: string;
  messages: Array<{ role: string; content: MessageContent }>;
  temperature?: number;
  max_tokens?: number;
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
      ...(options.max_tokens != null ? { max_tokens: options.max_tokens } : {}),
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
  messages: Array<{ role: string; content: MessageContent }>;
  temperature?: number;
  max_tokens?: number;
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
      ...(options.max_tokens != null ? { max_tokens: options.max_tokens } : {}),
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

/** Result collected after streaming completes. */
export interface StreamResult {
  content: string;
  tokensUsed: number | null;
}

/**
 * Send a streaming chat completion request to OpenRouter.
 * Returns a callback-based stream: call `onChunk(text)` for each content delta.
 * The returned promise resolves with the full accumulated result when done.
 */
export async function callOpenRouterStream(
  options: {
    model: string;
    messages: Array<{ role: string; content: MessageContent }>;
    temperature?: number;
    max_tokens?: number;
  },
  onChunk: (text: string) => void | Promise<void>
): Promise<StreamResult> {
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
      stream: true,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.max_tokens != null ? { max_tokens: options.max_tokens } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${errText}`);
  }

  if (!res.body) {
    throw new Error("No response body for streaming request");
  }

  let accumulated = "";
  let tokensUsed: number | null = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;

      const payload = trimmed.slice(6);
      if (payload === "[DONE]") continue;

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { total_tokens?: number };
        };
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          await onChunk(delta);
        }
        if (parsed?.usage?.total_tokens != null) {
          tokensUsed = parsed.usage.total_tokens;
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim().startsWith("data: ")) {
    const payload = buffer.trim().slice(6);
    if (payload !== "[DONE]") {
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { total_tokens?: number };
        };
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          await onChunk(delta);
        }
        if (parsed?.usage?.total_tokens != null) {
          tokensUsed = parsed.usage.total_tokens;
        }
      } catch {
        // skip
      }
    }
  }

  if (!accumulated) {
    throw new Error("Empty response from OpenRouter (streaming)");
  }

  return { content: accumulated, tokensUsed };
}
