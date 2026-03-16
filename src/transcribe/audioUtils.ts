/**
 * FFmpeg utilities for audio duration detection and chunking.
 * Used for long audio files that exceed API payload limits.
 */

import { execFile } from "child_process";
import { mkdir, readdir, unlink, rmdir, stat } from "fs/promises";
import { join, basename, extname } from "path";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("audio-utils");

/** Maximum chunk duration in seconds (5 minutes). */
export const MAX_CHUNK_DURATION_SEC = 300;

/**
 * Maximum file size in bytes for single-file transcription (20 MB).
 * Gemini supports up to ~20 MB inline base64 data (~27 MB base64).
 * Files larger than this will be chunked via ffmpeg.
 */
export const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Approximate bytes per second for OGG Opus audio (~4 KB/s at typical bitrates).
 * Used to estimate duration when ffprobe is unavailable.
 */
export const OGG_OPUS_BYTES_PER_SEC = 4_000;

/** Timeout for ffprobe calls (15 seconds). */
const FFPROBE_TIMEOUT_MS = 15_000;

/** Cached ffmpeg availability check result. */
let ffmpegAvailable: boolean | null = null;

/**
 * Check if ffmpeg/ffprobe are available on the system.
 * Result is cached after first call.
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync("ffprobe", ["-version"], { timeout: 5_000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
    log.warn("ffmpeg/ffprobe not found — audio chunking and format conversion will be unavailable. Install ffmpeg for best results.");
  }
  return ffmpegAvailable;
}

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
 * Convert non-OGG audio files to OGG Opus to reduce base64 payload size.
 * Compresses any non-OGG file when ffmpeg is available (mp3, wav, m4a, webm, flac, aac, etc.).
 * Returns the path to the converted file, or the original path if conversion is not needed/possible.
 */
export async function compressToOggIfNeeded(filePath: string): Promise<{ path: string; converted: boolean }> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".ogg") return { path: filePath, converted: false };

  if (!await isFFmpegAvailable()) {
    log.warn(`Cannot convert ${ext} to OGG — ffmpeg not available`);
    return { path: filePath, converted: false };
  }

  let fileSize: number;
  try {
    const s = await stat(filePath);
    fileSize = s.size;
  } catch {
    return { path: filePath, converted: false };
  }

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
    log.info(`Compressed ${filePath} (${fileSize}b, ${ext}) → ${outputPath}`);
    return { path: outputPath, converted: true };
  } catch (err) {
    log.error(`OGG compression failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return { path: filePath, converted: false };
  }
}

/**
 * Get file size in bytes. Returns 0 on error.
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
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
