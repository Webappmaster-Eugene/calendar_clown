/**
 * Transcribe audio file to text using OpenRouter (Gemini with audio input).
 * Gemini accepts OGG natively via inline_data, no conversion needed.
 */

import { readFile } from "fs/promises";
import { createLogger } from "../utils/logger.js";

const log = createLogger("stt");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TRANSCRIBE_MODEL = "google/gemini-2.0-flash-001";

/** Map file extension to MIME type for audio. */
function audioMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "ogg": return "audio/ogg";
    case "wav": return "audio/wav";
    case "mp3": return "audio/mpeg";
    case "m4a": return "audio/mp4";
    default: return "audio/ogg";
  }
}

export async function transcribeVoice(filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const fileBuffer = await readFile(filePath);
  const base64Audio = fileBuffer.toString("base64");
  const mimeType = audioMimeType(filePath);

  log.info(`STT call: model=${TRANSCRIBE_MODEL}, file=${filePath}, size=${fileBuffer.length}b`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const startTime = Date.now();

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/telegram-google-calendar-bot",
      },
      body: JSON.stringify({
        model: TRANSCRIBE_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe this audio to text. Output only the transcribed text in the same language, nothing else.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Audio}`,
                },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      log.error(`STT error: status=${res.status}, elapsed=${elapsed}ms, body=${errText}`);
      throw new Error(`OpenRouter transcription failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
    log.info(`STT response: status=${res.status}, elapsed=${elapsed}ms, length=${text.length}`);
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const elapsed = Date.now() - startTime;
      log.error(`STT timeout after ${elapsed}ms for file=${filePath}`);
      throw new Error("Транскрипция не завершилась за 60 секунд.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
