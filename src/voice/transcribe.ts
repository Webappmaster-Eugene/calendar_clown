import { stat, unlink } from "fs/promises";
import { callStt } from "./sttClient.js";
import { TRANSCRIBE_MODEL } from "../constants.js";
import { MAX_SINGLE_FILE_BYTES, compressToOggIfNeeded } from "../transcribe/audioUtils.js";

export type TranscribeContext = "calendar" | "general" | "expense" | "tasks";

const TRANSCRIBE_PROMPT_CALENDAR = `Расшифруй это аудиосообщение в текст на русском языке.

Вероятная тема (лишь подсказка, а не предположение): события для календаря — встречи, даты, время, имена. Транскрибируй строго то, что реально произнесено, даже если это не про календарь.

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
- Если часть аудио неразборчива — пропусти этот фрагмент, не додумывай
- ВАЖНО: если аудио пустое, это тишина, только шум/музыка, речь целиком на другом языке или всё полностью неразборчиво — верни ПУСТУЮ строку. Никогда не выдумывай события, даты, время, имена, суммы или задачи, которых нет в аудио. Пустая строка лучше выдуманного текста`;

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
- Если часть аудио неразборчива — пропусти этот фрагмент, не додумывай
- ВАЖНО: если аудио пустое, это тишина, только шум/музыка, речь целиком на другом языке или всё полностью неразборчиво — верни ПУСТУЮ строку. Никогда не выдумывай события, даты, время, имена, суммы или задачи, которых нет в аудио. Пустая строка лучше выдуманного текста`;

const TRANSCRIBE_PROMPT_EXPENSE = `Расшифруй это аудиосообщение в текст на русском языке.

Вероятная тема (лишь подсказка, а не предположение): расходы — категории трат, описания покупок, суммы. Транскрибируй строго то, что реально произнесено, даже если это не про расходы.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений
- Расставляй знаки препинания: точки, запятые
- Денежные суммы записывай цифрами. Примеры:
  "сто" → 100, "двести" → 200, "триста" → 300, "пятьсот" → 500
  "тысяча" → 1000, "полторы тысячи" → 1500, "две тысячи" → 2000
  "пять тысяч" → 5000, "десять тысяч" → 10000
  "двести пятьдесят" → 250, "три тысячи двести" → 3200
- Слова-паразиты ("эээ", "ммм") — убирай
- Если часть аудио неразборчива — пропусти этот фрагмент, не додумывай
- ВАЖНО: если аудио пустое, это тишина, только шум/музыка, речь целиком на другом языке или всё полностью неразборчиво — верни ПУСТУЮ строку. Никогда не выдумывай события, даты, время, имена, суммы или задачи, которых нет в аудио. Пустая строка лучше выдуманного текста`;

const TRANSCRIBE_PROMPT_TASKS = `Расшифруй это аудиосообщение в текст на русском языке.

Вероятная тема (лишь подсказка, а не предположение): задача для трекера — проект, что нужно сделать, срок. Транскрибируй строго то, что реально произнесено, даже если это не про задачи.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений
- Расставляй знаки препинания: точки, запятые
- Названия проектов и имена собственные пиши с большой буквы, не искажай их
- Выражения срока передавай как в речи: "завтра к шести", "к пятнице", "через 3 дня", "до 18:00"
- Числа и время записывай цифрами: "восемнадцать ноль ноль" → 18:00
- Слова-паразиты ("эээ", "ммм") — убирай
- Если часть аудио неразборчива — пропусти этот фрагмент, не додумывай
- ВАЖНО: если аудио пустое, это тишина, только шум/музыка, речь целиком на другом языке или всё полностью неразборчиво — верни ПУСТУЮ строку. Никогда не выдумывай события, даты, время, имена, суммы или задачи, которых нет в аудио. Пустая строка лучше выдуманного текста`;

export function getTranscribePromptForContext(context: TranscribeContext): string {
  const prompts: Record<TranscribeContext, string> = {
    calendar: TRANSCRIBE_PROMPT_CALENDAR,
    general: TRANSCRIBE_PROMPT_GENERAL,
    expense: TRANSCRIBE_PROMPT_EXPENSE,
    tasks: TRANSCRIBE_PROMPT_TASKS,
  };
  return prompts[context];
}

function getTimeoutMs(fileSizeBytes: number): number {
  // Headroom for OpenRouter/STT latency spikes so a normal short voice message
  // (small file) doesn't 503 mid-transcription during a slow-provider window.
  if (fileSizeBytes < 1_000_000) return 90_000;         // <1MB: 1.5min
  if (fileSizeBytes < 5_000_000) return 180_000;        // 1-5MB: 3min
  if (fileSizeBytes < 15_000_000) return 300_000;       // 5-15MB: 5min
  return 600_000;                                        // >15MB: 10min
}

export async function transcribeVoice(filePath: string, context: TranscribeContext = "calendar"): Promise<string> {
  // No-op for .ogg (bot path); if ffmpeg is unavailable, returns the original unchanged.
  const { path: effectivePath, converted } = await compressToOggIfNeeded(filePath);

  try {
    let fileSizeBytes = 0;
    try {
      const s = await stat(effectivePath);
      fileSizeBytes = s.size;
    } catch {
      // Stat failed → fall back to the default (smallest) timeout bucket.
    }

    // Large files would hang as a single base64 payload — delegate to HQ path with chunking.
    // HQ already uses a general-purpose prompt, so no context override needed.
    if (fileSizeBytes > MAX_SINGLE_FILE_BYTES) {
      const { transcribeVoiceHQ } = await import("../transcribe/transcribeHQ.js");
      return transcribeVoiceHQ(effectivePath);
    }

    const timeoutMs = getTimeoutMs(fileSizeBytes);
    const prompt = getTranscribePromptForContext(context);

    return callStt({
      filePath: effectivePath,
      prompt,
      timeoutMs,
      model: TRANSCRIBE_MODEL,
    });
  } finally {
    if (converted && effectivePath !== filePath) {
      await unlink(effectivePath).catch(() => {});
    }
  }
}
