import { OPENROUTER_URL, OPENROUTER_REFERER } from "../constants.js";
import { openRouterRequest, type OpenRouterHttpResponse } from "./proxyAgent.js";

/**
 * Hard upper bound for any single non-streaming OpenRouter call. Without this, a
 * stuck upstream (DeepSeek, etc.) silently wedges request handlers — and on the
 * Mini App side leaves the voice button frozen on "Обработка…" beyond the
 * client-side 120s timeout. Default 60s: long-form generation (e.g. blogger posts)
 * overran the previous 30s bound. Tunable via OPENROUTER_TIMEOUT_MS env.
 */
const OPENROUTER_TIMEOUT_MS = (() => {
  const raw = process.env.OPENROUTER_TIMEOUT_MS?.trim();
  if (!raw) return 60_000;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
})();

/** Content part for multimodal messages (text + images). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Message content: plain string or multimodal array. */
export type MessageContent = string | ContentPart[];

/** OpenRouter request with a hard timeout, normalizing the timeout error message. */
async function fetchWithTimeout(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  timeoutMs: number,
): Promise<OpenRouterHttpResponse> {
  try {
    return await openRouterRequest(url, { ...init, timeoutMs });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  }
}

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

  const res = await fetchWithTimeout(
    OPENROUTER_URL,
    {
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
    },
    OPENROUTER_TIMEOUT_MS
  );

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

  const res = await fetchWithTimeout(
    OPENROUTER_URL,
    {
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
    },
    OPENROUTER_TIMEOUT_MS
  );

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

  const res = await openRouterRequest(OPENROUTER_URL, {
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
    timeoutMs: OPENROUTER_TIMEOUT_MS,
    stream: true,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${errText}`);
  }

  if (!res.stream) {
    throw new Error("No response body for streaming request");
  }

  let accumulated = "";
  let tokensUsed: number | null = null;

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.stream) {
    buffer += decoder.decode(chunk as Buffer, { stream: true });
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
