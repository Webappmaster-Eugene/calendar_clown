import type { ApiResult } from "@shared/types";

let initDataRaw = "";

export function setInitData(raw: string): void {
  initDataRaw = raw;
}

export function getInitData(): string {
  return initDataRaw;
}

class ApiError extends Error {
  public data: unknown;
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.data = data;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
  externalSignal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (initDataRaw) {
    headers["Authorization"] = `tma ${initDataRaw}`;
  }

  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  // Compose the timeout-driven controller with an optional caller-provided signal
  // so the caller can cancel (e.g. user pressed "Отмена" while uploading audio).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

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
    externalSignal?.removeEventListener("abort", onExternalAbort);
    if (err instanceof DOMException && err.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new ApiError(0, "ABORTED", "Запрос отменён");
      }
      const timeoutSec = Math.round(timeoutMs / 1000);
      throw new ApiError(0, "TIMEOUT", `Request timed out after ${timeoutSec} seconds`);
    }
    throw err;
  }

  clearTimeout(timeoutId);
  externalSignal?.removeEventListener("abort", onExternalAbort);

  let json: ApiResult<T>;
  try {
    json = (await res.json()) as ApiResult<T>;
  } catch {
    throw new ApiError(res.status, "PARSE_ERROR", "Invalid server response");
  }

  if (!json.ok) {
    throw new ApiError(res.status, json.code, json.error, json.data);
  }

  return json.data;
}

export interface StreamDoneEvent {
  dialogId: number;
  messageId: number;
}

export interface StreamOptions {
  /** Progress labels emitted before generation starts (link reading, web search). */
  onStatus?: (label: string, kind?: string) => void;
  signal?: AbortSignal;
}

async function streamRequest(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  opts?: StreamOptions
): Promise<StreamDoneEvent> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (initDataRaw) {
    headers["Authorization"] = `tma ${initDataRaw}`;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "ABORTED", "Генерация остановлена");
    }
    throw err;
  }

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) errorMsg = json.error;
    } catch { /* ignore */ }
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
    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch (err) {
      if (opts?.signal?.aborted) throw new ApiError(0, "ABORTED", "Генерация остановлена");
      throw err;
    }
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
          } else if (currentEvent === "status" && parsed.label != null) {
            opts?.onStatus?.(parsed.label, parsed.kind);
          } else if (currentEvent === "done" && parsed.dialogId != null) {
            doneEvent = parsed as StreamDoneEvent;
          } else if (currentEvent === "error" && parsed.error != null) {
            throw new ApiError(0, "STREAM_ERROR", parsed.error);
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
        }
      }
    }
  }

  if (!doneEvent) {
    throw new ApiError(0, "STREAM_INCOMPLETE", "Stream ended without completion event");
  }

  return doneEvent;
}

// For authenticated images: a plain <img src=...> can't attach the Authorization header our API requires.
async function getBlob(path: string, timeoutMs = 30_000): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (initDataRaw) {
    headers["Authorization"] = `tma ${initDataRaw}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, { method: "GET", headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "TIMEOUT", `Request timed out`);
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    throw new ApiError(res.status, undefined, `Failed to fetch ${path} (status ${res.status})`);
  }
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  // 180s: must exceed the backend STT timeout for a max-length recording (<5MB → 180s)
  // and stay below VoiceButton's watchdog. See MAX_RECORDING_MS in useVoiceRecorder.
  upload: <T>(path: string, formData: FormData, signal?: AbortSignal, timeoutMs = 180_000) =>
    request<T>("POST", path, formData, timeoutMs, signal),
  uploadPatch: <T>(path: string, formData: FormData) => request<T>("PATCH", path, formData, 120_000),
  getBlob,
  stream: streamRequest,
};

export { ApiError };
