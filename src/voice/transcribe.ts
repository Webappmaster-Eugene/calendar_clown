/**
 * Transcribe audio file to text using the shared STT client.
 * Supports three contexts: "calendar", "expense" (expense-specific with number examples), and "general".
 * Non-OGG files (e.g. WebM from Mini App) are compressed to OGG Opus before STT.
 * Large files are delegated to the HQ transcriber which supports chunking.
 */

import { stat, unlink } from "fs/promises";
import { callStt } from "./sttClient.js";
import { TRANSCRIBE_MODEL } from "../constants.js";
import { MAX_SINGLE_FILE_BYTES, compressToOggIfNeeded } from "../transcribe/audioUtils.js";

export type TranscribeContext = "calendar" | "general" | "expense";

const TRANSCRIBE_PROMPT_CALENDAR = `Расшифруй это аудиосообщение в текст на русском языке.

Контекст: пользователь диктует события для календаря — встречи, записи, мероприятия с указанием дат, времени и имён.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений
- Расставляй знаки препинания: точки, запятые
- Числа записывай цифрами. Примеры:
  "сто" → 100, "двести" → 200, "триста" → 300, "пятьсот" → 500
  "тысяча" → 1000, "полторы тысячи" → 1500, "две тысячи" → 2000
  "пять тысяч" → 5000, "десять тысяч" → 10000
  "двести пятьдесят" → 250, "три тысячи двести" → 3200
- Имена собственные пиши с большой буквы
- Слова-паразиты ("эээ", "ммм") — убирай
- Если часть аудио неразборчива — пропусти, не додумывай`;

const TRANSCRIBE_PROMPT_GENERAL = `Расшифруй это аудиосообщение в текст на русском языке.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений и комментариев
- Расставляй знаки препинания: точки, запятые, вопросительные и восклицательные знаки
- Разбивай на абзацы по смыслу (если сообщение длинное)
- Не добавляй слова, которых нет в аудио
- Числа записывай цифрами. Примеры:
  "сто" → 100, "двести" → 200, "триста" → 300, "пятьсот" → 500
  "тысяча" → 1000, "полторы тысячи" → 1500, "две тысячи" → 2000
  "пять тысяч" → 5000, "десять тысяч" → 10000
  "двести пятьдесят" → 250, "три тысячи двести" → 3200
- Имена собственные пиши с большой буквы
- Слова-паразиты ("эээ", "ммм", "ну типа") — убирай
- Если речь содержит английские термины (API, frontend, backend, LMS и т.п.) — записывай их латиницей, не транслитерируй
- Если часть аудио неразборчива — пропусти, не додумывай`;

const TRANSCRIBE_PROMPT_EXPENSE = `Расшифруй это аудиосообщение в текст на русском языке.

Контекст: пользователь диктует расходы — категории трат, описания покупок, суммы в рублях.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений
- Расставляй знаки препинания: точки, запятые
- Денежные суммы записывай цифрами. Примеры:
  "сто" → 100, "двести" → 200, "триста" → 300, "пятьсот" → 500
  "тысяча" → 1000, "полторы тысячи" → 1500, "две тысячи" → 2000
  "пять тысяч" → 5000, "десять тысяч" → 10000
  "двести пятьдесят" → 250, "три тысячи двести" → 3200
- Слова-паразиты ("эээ", "ммм") — убирай
- Если часть аудио неразборчива — пропусти, не додумывай`;

/** Calculate dynamic timeout based on file size in bytes. */
function getTimeoutMs(fileSizeBytes: number): number {
  if (fileSizeBytes < 1_000_000) return 60_000;        // <1MB: 1min
  if (fileSizeBytes < 5_000_000) return 120_000;        // 1-5MB: 2min
  if (fileSizeBytes < 15_000_000) return 300_000;       // 5-15MB: 5min
  return 600_000;                                        // >15MB: 10min
}

export async function transcribeVoice(filePath: string, context: TranscribeContext = "calendar"): Promise<string> {
  // Compress non-OGG files (WebM from Mini App, MP4 from iOS) to OGG Opus.
  // For .ogg files (bot path) this is a no-op with zero overhead.
  // If ffmpeg is unavailable, returns the original file unchanged (graceful degradation).
  const { path: effectivePath, converted } = await compressToOggIfNeeded(filePath);

  try {
    let fileSizeBytes = 0;
    try {
      const s = await stat(effectivePath);
      fileSizeBytes = s.size;
    } catch {
      // If stat fails, use default timeout
    }

    // Large files would hang as a single base64 payload — delegate to HQ path with chunking.
    // HQ already uses a general-purpose prompt, so no context override needed.
    if (fileSizeBytes > MAX_SINGLE_FILE_BYTES) {
      const { transcribeVoiceHQ } = await import("../transcribe/transcribeHQ.js");
      return transcribeVoiceHQ(effectivePath);
    }

    const timeoutMs = getTimeoutMs(fileSizeBytes);
    const prompt = context === "general"
      ? TRANSCRIBE_PROMPT_GENERAL
      : context === "expense"
        ? TRANSCRIBE_PROMPT_EXPENSE
        : TRANSCRIBE_PROMPT_CALENDAR;

    return callStt({
      filePath: effectivePath,
      prompt,
      timeoutMs,
      model: TRANSCRIBE_MODEL,
    });
  } finally {
    // Clean up the compressed file if conversion occurred
    if (converted && effectivePath !== filePath) {
      await unlink(effectivePath).catch(() => {});
    }
  }
}
