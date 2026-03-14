/**
 * High-quality voice transcription for the transcriber mode.
 * Uses Gemini 2.5 Flash with an optimized Russian-language prompt
 * for clean, readable text with proper punctuation.
 */

import { readFile } from "fs/promises";
import { OPENROUTER_URL, OPENROUTER_REFERER, TRANSCRIBE_MODEL_HQ } from "../constants.js";

const TRANSCRIBE_PROMPT = `Расшифруй это аудиосообщение в текст на русском языке.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений и комментариев
- Расставляй знаки препинания: точки, запятые, вопросительные и восклицательные знаки
- Разбивай на абзацы по смыслу (если сообщение длинное)
- Не добавляй слова, которых нет в аудио
- Числа записывай цифрами
- Слова-паразиты ("эээ", "ммм", "ну типа") — убирай
- Если часть аудио неразборчива — пропусти, не додумывай`;

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

/**
 * Transcribe an audio file using Gemini 2.5 Flash with high-quality Russian prompt.
 * Returns the transcript text or throws on error.
 */
export async function transcribeVoiceHQ(filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const fileBuffer = await readFile(filePath);
  const base64Audio = fileBuffer.toString("base64");
  const mimeType = audioMimeType(filePath);

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
    },
    body: JSON.stringify({
      model: TRANSCRIBE_MODEL_HQ,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TRANSCRIBE_PROMPT },
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
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter HQ transcription failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  return text;
}
