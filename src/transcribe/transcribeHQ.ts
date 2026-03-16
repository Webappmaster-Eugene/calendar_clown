/**
 * High-quality voice transcription for the transcriber mode.
 * Uses the shared STT client with provider routing and geo-block fallback.
 * Supports long audio files via ffmpeg-based chunking.
 */

import { stat, unlink } from "fs/promises";
import { join, basename, extname } from "path";
import { callStt } from "../voice/sttClient.js";
import { TRANSCRIBE_MODEL_HQ, VOICE_DIR } from "../constants.js";
import {
  getAudioDuration,
  splitAudio,
  compressToOggIfNeeded,
  cleanupChunkDir,
  MAX_CHUNK_DURATION_SEC,
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
- Если часть аудио неразборчива — пропусти, не додумывай`;

/** Calculate dynamic timeout based on file size in bytes. */
function getTimeoutMs(fileSizeBytes: number): number {
  if (fileSizeBytes < 1_000_000) return 120_000;       // <1MB: 2min
  if (fileSizeBytes < 5_000_000) return 300_000;        // 1-5MB: 5min
  if (fileSizeBytes < 15_000_000) return 600_000;       // 5-15MB: 10min
  return 900_000;                                        // >15MB: 15min
}

/**
 * Transcribe an audio file with high-quality Russian prompt.
 * For files longer than 10 minutes, splits into chunks and transcribes each sequentially.
 */
export async function transcribeVoiceHQ(filePath: string, onProgress?: OnProgressCallback): Promise<string> {
  // Try to compress large non-OGG files first
  if (onProgress) {
    const ext = extname(filePath).toLowerCase();
    if (ext !== ".ogg") {
      onProgress("Сжатие аудио...");
    }
  }
  const { path: effectivePath, converted } = await compressToOggIfNeeded(filePath);

  try {
    const duration = await getAudioDuration(effectivePath);
    log.info(`Audio duration: ${duration.toFixed(1)}s for ${effectivePath}`);

    const durationMin = Math.floor(duration / 60);
    const durationSec = Math.floor(duration % 60);
    onProgress?.(`Длительность: ${durationMin}:${durationSec.toString().padStart(2, "0")}`);

    if (duration > 0 && duration > MAX_CHUNK_DURATION_SEC) {
      return await transcribeWithChunking(effectivePath, duration, onProgress);
    }

    return await transcribeSingleFile(effectivePath, onProgress);
  } finally {
    // Clean up compressed file if we created one
    if (converted && effectivePath !== filePath) {
      await unlink(effectivePath).catch(() => {});
    }
  }
}

/** Transcribe a single audio file (no chunking). */
async function transcribeSingleFile(filePath: string, onProgress?: OnProgressCallback): Promise<string> {
  let fileSizeBytes = 0;
  try {
    const s = await stat(filePath);
    fileSizeBytes = s.size;
  } catch {
    // Use default timeout
  }

  const timeoutMs = getTimeoutMs(fileSizeBytes);

  onProgress?.("Транскрибация...");

  return callStt({
    filePath,
    prompt: TRANSCRIBE_PROMPT,
    timeoutMs,
    model: TRANSCRIBE_MODEL_HQ,
    onProgress,
  });
}

/** Transcribe a long audio file by splitting into chunks. */
async function transcribeWithChunking(filePath: string, duration: number, onProgress?: OnProgressCallback): Promise<string> {
  const base = basename(filePath, extname(filePath));
  const chunkDir = join(VOICE_DIR, `chunks_${base}_${Date.now()}`);

  log.info(`Splitting ${filePath} (${duration.toFixed(1)}s) into ${MAX_CHUNK_DURATION_SEC}s chunks`);
  onProgress?.("Разделение на части...");

  let chunkPaths: string[];
  try {
    chunkPaths = await splitAudio(filePath, MAX_CHUNK_DURATION_SEC, chunkDir);
  } catch (err) {
    log.error(`Chunking failed, falling back to single-file transcription: ${err instanceof Error ? err.message : String(err)}`);
    // Fallback: try sending the whole file as-is
    return transcribeSingleFile(filePath, onProgress);
  }

  if (chunkPaths.length === 0) {
    log.error("No chunks produced, falling back to single-file transcription");
    await cleanupChunkDir(chunkDir);
    return transcribeSingleFile(filePath, onProgress);
  }

  log.info(`Processing ${chunkPaths.length} chunks sequentially`);
  onProgress?.(`Разделено на ${chunkPaths.length} частей`);

  try {
    const transcripts: string[] = [];

    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      const chunkLabel = `Часть ${i + 1}/${chunkPaths.length}`;
      log.info(`Transcribing chunk ${i + 1}/${chunkPaths.length}: ${chunkPath}`);
      onProgress?.(`${chunkLabel} — транскрибация...`);

      let chunkSize = 0;
      try {
        const s = await stat(chunkPath);
        chunkSize = s.size;
      } catch {
        // Use default timeout
      }

      const timeoutMs = getTimeoutMs(chunkSize);
      const text = await callStt({
        filePath: chunkPath,
        prompt: TRANSCRIBE_PROMPT,
        timeoutMs,
        model: TRANSCRIBE_MODEL_HQ,
        onProgress,
      });

      if (text) {
        transcripts.push(text);
      }

      onProgress?.(`${chunkLabel} — готово (${text.length} симв.)`);

      // Small delay between chunks to avoid rate limiting
      if (i < chunkPaths.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }

    const combined = transcripts.join("\n\n");
    log.info(`Chunked transcription complete: ${chunkPaths.length} chunks → ${combined.length} chars`);
    return combined;
  } finally {
    await cleanupChunkDir(chunkDir);
  }
}
