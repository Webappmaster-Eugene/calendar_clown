import { OPENROUTER_URL, OPENROUTER_REFERER } from "../constants.js";
import { openRouterRequest, type OpenRouterHttpResponse } from "./proxyAgent.js";

// Hard per-call timeout: a stuck upstream otherwise silently wedges request
// handlers and freezes the Mini App voice button past its client-side 120s bound.
export function resolveOpenRouterTimeoutMs(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return 60_000;
  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

const OPENROUTER_TIMEOUT_MS = resolveOpenRouterTimeoutMs(process.env.OPENROUTER_TIMEOUT_MS);

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type MessageContent = string | ContentPart[];

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

export interface StreamResult {
  content: string;
  tokensUsed: number | null;
}

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
        /* empty */
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
        /* empty */
      }
    }
  }

  if (!accumulated) {
    throw new Error("Empty response from OpenRouter (streaming)");
  }

  return { content: accumulated, tokensUsed };
}
