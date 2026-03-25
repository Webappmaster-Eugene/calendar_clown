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

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, formData: FormData) => request<T>("POST", path, formData, 120_000),
};

export { ApiError };
