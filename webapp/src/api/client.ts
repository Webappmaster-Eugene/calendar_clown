/**
 * API client with Telegram initData authorization.
 */
import type { ApiResult } from "@shared/types";

let initDataRaw = "";

/** Set initData from Telegram SDK. Called once on app init. */
export function setInitData(raw: string): void {
  initDataRaw = raw;
}

/** Get current initData (for components that need it). */
export function getInitData(): string {
  return initDataRaw;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (initDataRaw) {
    headers["Authorization"] = `tma ${initDataRaw}`;
  }

  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutSec = Math.round(timeoutMs / 1000);
      throw new ApiError(0, "TIMEOUT", `Request timed out after ${timeoutSec} seconds`);
    }
    throw err;
  }

  clearTimeout(timeoutId);

  const json = (await res.json()) as ApiResult<T>;

  if (!json.ok) {
    throw new ApiError(res.status, json.code, json.error);
  }

  return json.data;
}

export interface StreamDoneEvent {
  dialogId: number;
  messageId: number;
}

/**
 * POST with SSE streaming response.
 * Calls onChunk for each content delta.
 * Returns final metadata when stream completes.
 */
async function streamRequest(
  path: string,
  body: unknown,
  onChunk: (text: string) => void
): Promise<StreamDoneEvent> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (initDataRaw) {
    headers["Authorization"] = `tma ${initDataRaw}`;
  }

  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) errorMsg = json.error;
    } catch { /* use default */ }
    throw new ApiError(res.status, undefined, errorMsg);
  }

  if (!res.body) {
    throw new ApiError(0, "NO_BODY", "No response body for streaming request");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let doneEvent: StreamDoneEvent | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        currentEvent = "";
        continue;
      }

      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7);
        continue;
      }

      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        try {
          const parsed = JSON.parse(payload);

          if (currentEvent === "chunk" && parsed.content != null) {
            onChunk(parsed.content);
          } else if (currentEvent === "done" && parsed.dialogId != null) {
            doneEvent = parsed as StreamDoneEvent;
          } else if (currentEvent === "error" && parsed.error != null) {
            throw new ApiError(0, "STREAM_ERROR", parsed.error);
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
          // skip malformed JSON
        }
      }
    }
  }

  if (!doneEvent) {
    throw new ApiError(0, "STREAM_INCOMPLETE", "Stream ended without completion event");
  }

  return doneEvent;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, formData: FormData) => request<T>("POST", path, formData, 120_000),
  stream: streamRequest,
};

export { ApiError };
