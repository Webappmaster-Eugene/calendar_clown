/**
 * Shared STT client with provider routing and model fallback.
 * Forces Vertex AI provider (no geo-blocks) and falls back to a chain of
 * alternative models if the primary returns a transient or geo-block error.
 *
 * User-facing errors are wrapped in SttError with a friendly Russian message;
 * raw OpenRouter response bodies are kept only in logs.
 */

import { readFile } from "fs/promises";
import { OPENROUTER_URL, OPENROUTER_REFERER, TRANSCRIBE_MODEL, TRANSCRIBE_MODEL_FALLBACKS } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { OnProgressCallback } from "../transcribe/types.js";

const log = createLogger("stt-client");

/**
 * STT failure reported to the user. The `message` is human-friendly Russian text
 * safe to show in Telegram; `raw` carries the upstream body for logs/telemetry.
 */
export class SttError extends Error {
  readonly model: string;
  readonly status: number | null;
  readonly raw: string;

  constructor(userMessage: string, opts: { model: string; status: number | null; raw: string }) {
    super(userMessage);
    this.name = "SttError";
    this.model = opts.model;
    this.status = opts.status;
    this.raw = opts.raw;
  }
}

export interface SttCallOptions {
  /** Path to the audio file. */
  filePath: string;
  /** System/user prompt for the transcription. */
  prompt: string;
  /** Timeout in milliseconds. */
  timeoutMs: number;
  /** Model override (defaults to TRANSCRIBE_MODEL from constants). */
  model?: string;
  /** Optional progress callback for real-time status updates. */
  onProgress?: OnProgressCallback;
}

/** Map file extension to MIME type for audio. */
function audioMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "ogg": return "audio/ogg";
    case "wav": return "audio/wav";
    case "mp3": return "audio/mpeg";
    case "m4a": return "audio/mp4";
    case "webm": return "audio/webm";
    case "flac": return "audio/flac";
    case "aac": return "audio/aac";
    default: return "audio/ogg";
  }
}

interface ParsedUpstreamError {
  code: number | null;
  message: string;
}

/** Best-effort parse of OpenRouter error body. */
function parseUpstreamError(body: string): ParsedUpstreamError {
  try {
    const json = JSON.parse(body) as { error?: { code?: number; message?: string } };
    return { code: json?.error?.code ?? null, message: json?.error?.message ?? body };
  } catch {
    return { code: null, message: body };
  }
}

/** Detect transient/retryable upstream conditions where another model is worth trying. */
function isRetryableUpstreamError(status: number, message: string): boolean {
  if (status >= 500) return true;
  if (status === 429) return true;
  const lower = message.toLowerCase();
  if (lower.includes("location") && (lower.includes("not supported") || lower.includes("not available"))) return true;
  if (lower.includes("not a valid model")) return true;
  if (lower.includes("model not found")) return true;
  if (lower.includes("no allowed providers")) return true;
  return false;
}

/** Map an upstream error to a user-friendly Russian message. */
function userMessageFor(status: number | null, message: string): string {
  if (status === 429) return "Сервис распознавания перегружен. Попробуйте через минуту.";
  if (status != null && status >= 500) return "Сервис распознавания временно недоступен. Попробуйте позже.";
  const lower = message.toLowerCase();
  if (lower.includes("location") && (lower.includes("not supported") || lower.includes("not available"))) {
    return "Сервис распознавания недоступен в этом регионе.";
  }
  if (lower.includes("not a valid model") || lower.includes("model not found")) {
    return "Модель распознавания недоступна. Сообщите администратору.";
  }
  return "Не удалось распознать речь. Попробуйте ещё раз.";
}

/**
 * Call OpenRouter STT API with provider routing (Vertex AI) and automatic
 * fallback through a chain of alternative models on retryable errors.
 *
 * Throws SttError with a user-friendly message; full upstream body is logged.
 */
export async function callStt(options: SttCallOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new SttError("Сервис распознавания не настроен. Сообщите администратору.", {
      model: options.model ?? TRANSCRIBE_MODEL,
      status: null,
      raw: "OPENROUTER_API_KEY is not set",
    });
  }

  const primaryModel = options.model ?? TRANSCRIBE_MODEL;
  const fileBuffer = await readFile(options.filePath);
  const base64Audio = fileBuffer.toString("base64");
  const mimeType = audioMimeType(options.filePath);

  // Build chain: primary first, then fallbacks (de-duplicated, primary excluded).
  // Pin vertex-ai only for Google-hosted models — it's a no-op (or worse) for OpenAI/etc.
  const chain: Array<{ model: string; pinVertex: boolean }> = [
    { model: primaryModel, pinVertex: primaryModel.startsWith("google/") },
  ];
  for (const m of TRANSCRIBE_MODEL_FALLBACKS) {
    if (m && m !== primaryModel && !chain.some((c) => c.model === m)) {
      chain.push({ model: m, pinVertex: m.startsWith("google/") });
    }
  }

  log.info(`STT call: primary=${primaryModel}, fallbacks=[${chain.slice(1).map((c) => c.model).join(", ")}], file=${options.filePath}, size=${fileBuffer.length}b, timeout=${options.timeoutMs}ms`);

  let lastErr: SttError | null = null;
  for (let i = 0; i < chain.length; i++) {
    const { model, pinVertex } = chain[i];
    const isPrimary = i === 0;

    if (!isPrimary) {
      options.onProgress?.(`Запасная модель: ${model}...`);
    } else {
      options.onProgress?.(`Запрос к ${model}...`);
    }

    try {
      return await callSttRaw({
        apiKey,
        model,
        prompt: options.prompt,
        base64Audio,
        mimeType,
        timeoutMs: options.timeoutMs,
        filePath: options.filePath,
        onProgress: options.onProgress,
        // Pin vertex-ai only for the primary Gemini-style model; for fallbacks let
        // OpenRouter pick the best route. allow_fallbacks=false avoids silent re-routing
        // to AI Studio, which is the usual source of "User location is not supported".
        provider: pinVertex ? { order: ["vertex-ai"], allow_fallbacks: false } : undefined,
      });
    } catch (err) {
      if (err instanceof SttError) {
        lastErr = err;
        // status=null means timeout/network — also worth trying another model.
        const retryable = err.status == null || isRetryableUpstreamError(err.status, err.raw);
        const hasNext = i < chain.length - 1;
        if (retryable && hasNext) {
          log.warn(`STT model=${model} failed (status=${err.status}), trying next fallback`);
          continue;
        }
        throw err;
      }
      // Non-SttError (timeout, network) — also try the next fallback if we have one.
      if (i < chain.length - 1) {
        log.warn(`STT model=${model} threw non-HTTP error, trying next fallback: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      throw err;
    }
  }

  // Defensive: loop above always returns or throws, but TS needs an explicit fallthrough.
  throw lastErr ?? new SttError("Не удалось распознать речь.", { model: primaryModel, status: null, raw: "no fallbacks succeeded" });
}

interface SttRawOptions {
  apiKey: string;
  model: string;
  prompt: string;
  base64Audio: string;
  mimeType: string;
  timeoutMs: number;
  filePath: string;
  onProgress?: OnProgressCallback;
  provider?: { order: string[]; allow_fallbacks: boolean };
}

/** Low-level single STT call. Throws SttError on HTTP errors. */
async function callSttRaw(options: SttRawOptions): Promise<string> {
  const { apiKey, model, prompt, base64Audio, mimeType, timeoutMs, filePath, provider } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Audio}`,
              },
            },
          ],
        },
      ],
    };

    if (provider) {
      body.provider = provider;
    }

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      log.error(`STT error: model=${model}, status=${res.status}, elapsed=${elapsed}ms, body=${errText}`);
      const parsed = parseUpstreamError(errText);
      throw new SttError(userMessageFor(res.status, parsed.message), {
        model,
        status: res.status,
        raw: errText,
      });
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
    log.info(`STT response: model=${model}, status=${res.status}, elapsed=${elapsed}ms, length=${text.length}`);
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const elapsed = Date.now() - startTime;
      log.error(`STT timeout after ${elapsed}ms for model=${model}, file=${filePath}`);
      const timeoutSec = Math.round(timeoutMs / 1000);
      throw new SttError(`Транскрипция не завершилась за ${timeoutSec} секунд.`, {
        model,
        status: null,
        raw: `AbortError after ${elapsed}ms`,
      });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
