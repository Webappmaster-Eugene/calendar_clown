/**
 * Shared STT client with provider routing and model fallback.
 * Forces Vertex AI provider (no geo-blocks) and falls back to OpenAI model
 * if the primary model returns a location-related error.
 */

import { readFile } from "fs/promises";
import { OPENROUTER_URL, OPENROUTER_REFERER, TRANSCRIBE_MODEL, TRANSCRIBE_MODEL_FALLBACK } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type { OnProgressCallback } from "../transcribe/types.js";

const log = createLogger("stt-client");

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

/** Check if an error body indicates a geo-block / location restriction. */
function isGeoBlockError(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("location") && (lower.includes("not supported") || lower.includes("not available"));
}

/**
 * Call OpenRouter STT API with provider routing (Vertex AI) and automatic
 * fallback to an alternative model on geo-block errors.
 */
export async function callStt(options: SttCallOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model = options.model ?? TRANSCRIBE_MODEL;
  const fileBuffer = await readFile(options.filePath);
  const base64Audio = fileBuffer.toString("base64");
  const mimeType = audioMimeType(options.filePath);

  log.info(`STT call: model=${model}, file=${options.filePath}, size=${fileBuffer.length}b, base64Size=${base64Audio.length}, timeout=${options.timeoutMs}ms`);

  options.onProgress?.(`Запрос к ${model}...`);

  const result = await callSttRaw({
    apiKey,
    model,
    prompt: options.prompt,
    base64Audio,
    mimeType,
    timeoutMs: options.timeoutMs,
    filePath: options.filePath,
    onProgress: options.onProgress,
    provider: {
      order: ["vertex-ai"],
      allow_fallbacks: true,
    },
  });

  return result;
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

/** Low-level STT call with optional provider routing and geo-block fallback. */
async function callSttRaw(options: SttRawOptions): Promise<string> {
  const { apiKey, model, prompt, base64Audio, mimeType, timeoutMs, filePath, onProgress, provider } = options;

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

      // On geo-block error with primary model → retry with fallback model (no provider override)
      if (res.status === 400 && isGeoBlockError(errText) && model !== TRANSCRIBE_MODEL_FALLBACK) {
        log.info(`Geo-block detected for model=${model}, retrying with fallback model=${TRANSCRIBE_MODEL_FALLBACK}`);
        onProgress?.(`Гео-блокировка, переключение на ${TRANSCRIBE_MODEL_FALLBACK}...`);
        clearTimeout(timeout);
        return callSttRaw({
          apiKey,
          model: TRANSCRIBE_MODEL_FALLBACK,
          prompt,
          base64Audio,
          mimeType,
          timeoutMs,
          filePath,
          onProgress,
          // No provider override for fallback — let OpenRouter pick the best route
        });
      }

      throw new Error(`OpenRouter STT failed: ${res.status} ${errText}`);
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
      throw new Error(`Транскрипция не завершилась за ${timeoutSec} секунд.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
