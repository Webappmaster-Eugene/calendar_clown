/**
 * High-quality voice transcription for the transcriber mode.
 * Uses the shared STT client with provider routing and geo-block fallback.
 * Supports long audio files via ffmpeg-based chunking.
 * When ffmpeg is not available, sends the file as-is (up to 20 MB).
 */

import { unlink } from "fs/promises";
import { join, basename, extname } from "path";
import { callStt } from "../voice/sttClient.js";
import { TRANSCRIBE_MODEL_HQ, TRANSCRIBE_MODEL_FALLBACK, VOICE_DIR } from "../constants.js";
import {
  getAudioDuration,
  splitAudio,
  compressToOggIfNeeded,
  cleanupChunkDir,
  getFileSize,
  isFFmpegAvailable,
  MAX_CHUNK_DURATION_SEC,
  MAX_SINGLE_FILE_BYTES,
  OGG_OPUS_BYTES_PER_SEC,
} from "./audioUtils.js";
import { createLogger } from "../utils/logger.js";
import type { OnProgressCallback } from "./types.js";

const log = createLogger("transcribe-hq");

const TRANSCRIBE_PROMPT = `Расшифруй это аудиосообщение в текст на русском языке.

Правила:
- Выводи ТОЛЬКО расшифрованный текст, без пояснений и комментариев
- Расставляй знаки препинания: точки, запятые, вопросительные и восклицательные знаки
- Разбивай на абзацы по смыслу (если сообщение длинное)
- Не добавляй слова, которых нет в аудио
- Числа записывай цифрами
- Слова-паразиты ("эээ", "ммм", "ну типа") — убирай
- Если речь содержит английские термины (API, frontend, backend, LMS и т.п.) — записывай их латиницей, не транслитерируй
- Если часть аудио неразборчива — пропусти, не додумывай`;

/**
 * Calculate timeout based on audio duration.
 * STT processing time correlates with audio duration, not file size.
 * Uses 2x real-time + 60s buffer, clamped to [120s, 1800s].
 */
function getTimeoutForDuration(durationSec: number): number {
  return Math.max(120_000, Math.min(durationSec * 2_000 + 60_000, 1_800_000));
}

/** Format duration in seconds as "M:SS". */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Transcribe an audio file with high-quality Russian prompt.
 * Strategy:
 * 1. Compress non-OGG files to OGG Opus (if ffmpeg available)
 * 2. If file fits within MAX_SINGLE_FILE_BYTES (20 MB) — send as-is
 * 3. If file is too large and ffmpeg available — split into chunks
 * 4. If file is too large and ffmpeg NOT available — send as-is with extended timeout (best effort)
 */
export async function transcribeVoiceHQ(filePath: string, onProgress?: OnProgressCallback, audioDurationHint?: number): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".ogg") {
    onProgress?.("Сжатие аудио в OGG...");
  }
  const { path: effectivePath, converted } = await compressToOggIfNeeded(filePath);

  try {
    // Detect duration (0 if ffprobe unavailable)
    const duration = await getAudioDuration(effectivePath);
    const fileSizeBytes = await getFileSize(effectivePath);

    // Use detected duration, Telegram hint, or estimate from file size
    const effectiveDuration = duration > 0
      ? duration
      : (audioDurationHint && audioDurationHint > 0)
        ? audioDurationHint
        : fileSizeBytes / OGG_OPUS_BYTES_PER_SEC;

    const durationStr = formatDuration(effectiveDuration);
    const sizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(1);
    log.info(`Audio: duration=${effectiveDuration.toFixed(1)}s (detected=${duration.toFixed(1)}s, hint=${audioDurationHint ?? "none"}), size=${sizeMB}MB, file=${effectivePath}`);
    onProgress?.(`Длительность: ${durationStr}, размер: ${sizeMB} МБ`);

    const hasFFmpeg = await isFFmpegAvailable();

    // Determine if chunking is needed
    const needsChunking =
      (effectiveDuration > MAX_CHUNK_DURATION_SEC) ||
      (fileSizeBytes > MAX_SINGLE_FILE_BYTES);

    if (!needsChunking) {
      // File is small enough — send as a single request
      return await transcribeSingleFile(effectivePath, effectiveDuration, onProgress);
    }

    if (hasFFmpeg) {
      // ffmpeg available — split into proper audio chunks
      return await transcribeWithChunking(effectivePath, effectiveDuration, onProgress);
    }

    // ffmpeg NOT available — try sending the whole file as-is if under payload limit
    if (fileSizeBytes <= MAX_SINGLE_FILE_BYTES) {
      log.info("No ffmpeg, but file fits single-file limit — sending as-is");
      return await transcribeSingleFile(effectivePath, effectiveDuration, onProgress);
    }

    // File is too large and no ffmpeg — best-effort: send as-is with extended timeout
    // Gemini can sometimes handle files slightly over the documented limit.
    log.warn(`No ffmpeg and file is ${sizeMB}MB (over ${MAX_SINGLE_FILE_BYTES / (1024 * 1024)}MB limit). Attempting single-file transcription anyway.`);
    onProgress?.(`ffmpeg недоступен. Попытка обработать ${sizeMB} МБ целиком...`);
    return await transcribeSingleFile(effectivePath, effectiveDuration, onProgress);
  } finally {
    if (converted && effectivePath !== filePath) {
      await unlink(effectivePath).catch(() => {});
    }
  }
}

/** Transcribe a single audio file (no chunking). Reports progress as %. */
async function transcribeSingleFile(filePath: string, durationSec: number, onProgress?: OnProgressCallback): Promise<string> {
  const timeoutMs = getTimeoutForDuration(durationSec);
  const durationStr = formatDuration(durationSec);
  log.info(`Single file transcription: duration=${durationSec.toFixed(1)}s, timeout=${timeoutMs}ms`);

  // Wrap progress to show overall % for single-file mode
  const wrappedProgress: OnProgressCallback | undefined = onProgress
    ? (step: string) => {
        onProgress(`Транскрибация (${durationStr}) — ${step}`);
      }
    : undefined;

  onProgress?.(`Транскрибация (${durationStr})... 0%`);

  try {
    const result = await callStt({
      filePath,
      prompt: TRANSCRIBE_PROMPT,
      timeoutMs,
      model: TRANSCRIBE_MODEL_HQ,
      onProgress: wrappedProgress,
    });
    onProgress?.(`Транскрибация завершена — 100% (${result.length} симв.)`);
    return result;
  } catch (primaryErr) {
    log.warn(`Primary model failed: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`);
    onProgress?.(`Основная модель недоступна, пробую запасную...`);
    const result = await callStt({
      filePath,
      prompt: TRANSCRIBE_PROMPT,
      timeoutMs,
      model: TRANSCRIBE_MODEL_FALLBACK,
      onProgress: wrappedProgress,
    });
    onProgress?.(`Транскрибация завершена — 100% (${result.length} симв.)`);
    return result;
  }
}

/** Transcribe a long audio file by splitting into chunks via ffmpeg. */
async function transcribeWithChunking(filePath: string, duration: number, onProgress?: OnProgressCallback): Promise<string> {
  const base = basename(filePath, extname(filePath));
  const chunkDir = join(VOICE_DIR, `chunks_${base}_${Date.now()}`);

  const totalDurationStr = formatDuration(duration);
  log.info(`Splitting ${filePath} (${duration.toFixed(1)}s) into ${MAX_CHUNK_DURATION_SEC}s chunks`);
  onProgress?.(`Разделение ${totalDurationStr} на части по ${formatDuration(MAX_CHUNK_DURATION_SEC)}...`);

  let chunkPaths: string[];
  try {
    chunkPaths = await splitAudio(filePath, MAX_CHUNK_DURATION_SEC, chunkDir);
  } catch (err) {
    log.error(`ffmpeg chunking failed: ${err instanceof Error ? err.message : String(err)}`);
    await cleanupChunkDir(chunkDir);
    // Fallback: try single-file transcription (may fail if file is too large)
    log.info("Chunking failed, falling back to single-file transcription");
    onProgress?.("Нарезка не удалась, пробую обработать целиком...");
    return transcribeSingleFile(filePath, duration, onProgress);
  }

  if (chunkPaths.length === 0) {
    log.error("No chunks produced, falling back to single-file transcription");
    await cleanupChunkDir(chunkDir);
    return transcribeSingleFile(filePath, duration, onProgress);
  }

  log.info(`Processing ${chunkPaths.length} chunks sequentially`);
  onProgress?.(`Разделено на ${chunkPaths.length} частей. Начинаю транскрибацию...`);

  try {
    const transcripts: string[] = [];
    const chunkTimeoutMs = getTimeoutForDuration(MAX_CHUNK_DURATION_SEC);
    let failedChunks = 0;
    let totalChars = 0;

    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      const pct = Math.round(((i) / chunkPaths.length) * 100);
      const chunkLabel = `[${pct}%] Часть ${i + 1}/${chunkPaths.length}`;
      log.info(`Transcribing chunk ${i + 1}/${chunkPaths.length}: ${chunkPath}, timeout=${chunkTimeoutMs}ms`);
      onProgress?.(`${chunkLabel} — транскрибация...`);

      let text = "";
      try {
        text = await callStt({
          filePath: chunkPath,
          prompt: TRANSCRIBE_PROMPT,
          timeoutMs: chunkTimeoutMs,
          model: TRANSCRIBE_MODEL_HQ,
          onProgress: onProgress
            ? (step: string) => onProgress(`${chunkLabel} — ${step}`)
            : undefined,
        });
      } catch (primaryErr) {
        log.warn(`Chunk ${i + 1} failed with primary model: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`);
        onProgress?.(`${chunkLabel} — повтор с запасной моделью...`);
        try {
          text = await callStt({
            filePath: chunkPath,
            prompt: TRANSCRIBE_PROMPT,
            timeoutMs: chunkTimeoutMs,
            model: TRANSCRIBE_MODEL_FALLBACK,
            onProgress: onProgress
              ? (step: string) => onProgress(`${chunkLabel} — ${step}`)
              : undefined,
          });
        } catch (fallbackErr) {
          log.error(`Chunk ${i + 1} fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
          text = "[неразборчиво]";
          failedChunks++;
        }
      }

      if (text) {
        transcripts.push(text);
        totalChars += text.length;
      }

      const donePct = Math.round(((i + 1) / chunkPaths.length) * 100);
      onProgress?.(`[${donePct}%] Часть ${i + 1}/${chunkPaths.length} готова (${totalChars} симв. всего)`);

      // Small delay between chunks to avoid rate limiting
      if (i < chunkPaths.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }

    // If ALL chunks failed, throw so BullMQ can retry the whole job
    if (failedChunks === chunkPaths.length) {
      throw new Error(`All ${chunkPaths.length} chunks failed transcription`);
    }

    const combined = transcripts.join("\n\n");
    log.info(`Chunked transcription complete: ${chunkPaths.length} chunks, ${failedChunks} failed → ${combined.length} chars`);
    onProgress?.(`Транскрибация завершена — 100% (${combined.length} симв., ${chunkPaths.length} частей)`);
    return combined;
  } finally {
    await cleanupChunkDir(chunkDir);
  }
}
