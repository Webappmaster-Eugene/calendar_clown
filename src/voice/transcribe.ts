/**
 * Transcribe audio file to text using the shared STT client.
 * Used for calendar/expenses voice mode (short messages).
 * Non-OGG files (e.g. WebM from Mini App) are compressed to OGG Opus before STT.
 * Large files are delegated to the HQ transcriber which supports chunking.
 */

import { stat, unlink } from "fs/promises";
import { callStt } from "./sttClient.js";
import { TRANSCRIBE_MODEL } from "../constants.js";
import { MAX_SINGLE_FILE_BYTES, compressToOggIfNeeded } from "../transcribe/audioUtils.js";

const TRANSCRIBE_PROMPT = `Расшифруй это аудиосообщение в текст на русском языке.

Контекст: пользователь диктует события для календаря — встречи, записи, мероприятия с указанием дат, времени и имён.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений
- Расставляй знаки препинания: точки, запятые
- Числа записывай цифрами
- Имена собственные пиши с большой буквы
- Слова-паразиты ("эээ", "ммм") — убирай
- Если часть аудио неразборчива — пропусти, не додумывай`;

/** Calculate dynamic timeout based on file size in bytes. */
function getTimeoutMs(fileSizeBytes: number): number {
  if (fileSizeBytes < 1_000_000) return 60_000;        // <1MB: 1min
  if (fileSizeBytes < 5_000_000) return 120_000;        // 1-5MB: 2min
  if (fileSizeBytes < 15_000_000) return 300_000;       // 5-15MB: 5min
  return 600_000;                                        // >15MB: 10min
}

export async function transcribeVoice(filePath: string): Promise<string> {
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

    // Large files would hang as a single base64 payload — delegate to HQ path with chunking
    if (fileSizeBytes > MAX_SINGLE_FILE_BYTES) {
      const { transcribeVoiceHQ } = await import("../transcribe/transcribeHQ.js");
      return transcribeVoiceHQ(effectivePath);
    }

    const timeoutMs = getTimeoutMs(fileSizeBytes);

    return callStt({
      filePath: effectivePath,
      prompt: TRANSCRIBE_PROMPT,
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
