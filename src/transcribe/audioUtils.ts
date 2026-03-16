/**
 * FFmpeg utilities for audio duration detection and chunking.
 * Used for long audio files that exceed API payload limits.
 */

import { execFile } from "child_process";
import { mkdir, readdir, unlink, rmdir, stat, readFile, writeFile } from "fs/promises";
import { join, basename, extname } from "path";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("audio-utils");

/** Maximum chunk duration in seconds (5 minutes). */
export const MAX_CHUNK_DURATION_SEC = 300;

/**
 * Maximum file size in bytes for single-file transcription (3 MB).
 * Files larger than this will be chunked regardless of duration,
 * because base64 encoding inflates the payload by ~33%.
 */
export const MAX_SINGLE_FILE_BYTES = 3 * 1024 * 1024;

/**
 * Approximate bytes per second for OGG Opus audio (~4 KB/s at typical bitrates).
 * Used to estimate duration when ffprobe is unavailable.
 */
export const OGG_OPUS_BYTES_PER_SEC = 4_000;

/** File size threshold for converting non-OGG files to OGG Opus (20MB). */
const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024;

/** Timeout for ffprobe calls (15 seconds). */
const FFPROBE_TIMEOUT_MS = 15_000;

/**
 * Get audio duration in seconds using ffprobe.
 * Returns 0 if ffprobe fails (caller should treat as short file).
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: FFPROBE_TIMEOUT_MS });
    const duration = parseFloat(stdout.trim());
    if (Number.isNaN(duration) || duration < 0) return 0;
    return duration;
  } catch (err) {
    log.error(`ffprobe failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/**
 * Split an audio file into chunks of maxChunkSec seconds each.
 * Returns an array of chunk file paths sorted by name.
 * The chunks are placed in a subdirectory: data/voice/chunks_<basename>/
 */
export async function splitAudio(
  filePath: string,
  maxChunkSec: number,
  outputDir: string
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });

  const ext = extname(filePath) || ".ogg";
  const pattern = join(outputDir, `chunk_%03d${ext}`);

  try {
    await execFileAsync("ffmpeg", [
      "-i", filePath,
      "-f", "segment",
      "-segment_time", String(maxChunkSec),
      "-c", "copy",
      "-v", "quiet",
      "-y",
      pattern,
    ]);
  } catch (err) {
    log.error(`ffmpeg split failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    throw new Error(`Failed to split audio: ${err instanceof Error ? err.message : String(err)}`);
  }

  const files = await readdir(outputDir);
  const chunkPaths = files
    .filter((f) => f.startsWith("chunk_"))
    .sort()
    .map((f) => join(outputDir, f));

  log.info(`Split ${filePath} into ${chunkPaths.length} chunks (max ${maxChunkSec}s each)`);
  return chunkPaths;
}

/**
 * Convert a large non-OGG file to OGG Opus to reduce base64 payload size.
 * Returns the path to the converted file, or the original path if conversion is not needed.
 */
export async function compressToOggIfNeeded(filePath: string): Promise<{ path: string; converted: boolean }> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".ogg") return { path: filePath, converted: false };

  let fileSize: number;
  try {
    const s = await stat(filePath);
    fileSize = s.size;
  } catch {
    return { path: filePath, converted: false };
  }

  if (fileSize < LARGE_FILE_THRESHOLD) return { path: filePath, converted: false };

  const base = basename(filePath, ext);
  const outputPath = join(filePath, "..", `${base}_compressed.ogg`);

  try {
    await execFileAsync("ffmpeg", [
      "-i", filePath,
      "-c:a", "libopus",
      "-b:a", "48k",
      "-v", "quiet",
      "-y",
      outputPath,
    ]);
    log.info(`Compressed ${filePath} (${fileSize}b) → ${outputPath}`);
    return { path: outputPath, converted: true };
  } catch (err) {
    log.error(`OGG compression failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return { path: filePath, converted: false };
  }
}

/**
 * Split an audio file into chunks by raw byte size.
 * Used as a fallback when ffmpeg is unavailable.
 * Chunks may not align to audio frame boundaries, but STT models
 * handle truncated audio gracefully — better than hanging on a 15MB payload.
 */
export async function splitAudioByBytes(
  filePath: string,
  maxChunkBytes: number,
  outputDir: string
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });

  const fileBuffer = await readFile(filePath);
  const totalSize = fileBuffer.length;

  if (totalSize <= maxChunkBytes) {
    // File fits in a single chunk — copy it as-is
    const ext = extname(filePath) || ".ogg";
    const chunkPath = join(outputDir, `chunk_000${ext}`);
    await writeFile(chunkPath, fileBuffer);
    log.info(`File ${filePath} (${totalSize}b) fits in single chunk, copied to ${chunkPath}`);
    return [chunkPath];
  }

  const ext = extname(filePath) || ".ogg";
  const chunkCount = Math.ceil(totalSize / maxChunkBytes);
  const chunkPaths: string[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * maxChunkBytes;
    const end = Math.min(start + maxChunkBytes, totalSize);
    const chunkData = fileBuffer.subarray(start, end);
    const chunkName = `chunk_${String(i).padStart(3, "0")}${ext}`;
    const chunkPath = join(outputDir, chunkName);
    await writeFile(chunkPath, chunkData);
    chunkPaths.push(chunkPath);
  }

  log.info(`Byte-split ${filePath} (${totalSize}b) into ${chunkPaths.length} chunks (max ${maxChunkBytes}b each)`);
  return chunkPaths;
}

/**
 * Remove a directory and all files within it.
 * Swallows errors silently.
 */
export async function cleanupChunkDir(dirPath: string): Promise<void> {
  try {
    const files = await readdir(dirPath);
    for (const f of files) {
      await unlink(join(dirPath, f)).catch(() => {});
    }
    await rmdir(dirPath).catch(() => {});
  } catch {
    // Directory may not exist — ignore
  }
}
