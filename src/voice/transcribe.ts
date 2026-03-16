/**
 * Transcribe audio file to text using the shared STT client.
 * Used for calendar/expenses voice mode (short messages).
 * Large files are delegated to the HQ transcriber which supports chunking.
 */

import { stat } from "fs/promises";
import { callStt } from "./sttClient.js";
import { TRANSCRIBE_MODEL } from "../constants.js";
import { MAX_SINGLE_FILE_BYTES } from "../transcribe/audioUtils.js";

const TRANSCRIBE_PROMPT = "Transcribe this audio to text. Output only the transcribed text in the same language, nothing else.";

/** Calculate dynamic timeout based on file size in bytes. */
function getTimeoutMs(fileSizeBytes: number): number {
  if (fileSizeBytes < 1_000_000) return 60_000;        // <1MB: 1min
  if (fileSizeBytes < 5_000_000) return 120_000;        // 1-5MB: 2min
  if (fileSizeBytes < 15_000_000) return 300_000;       // 5-15MB: 5min
  return 600_000;                                        // >15MB: 10min
}

export async function transcribeVoice(filePath: string): Promise<string> {
  let fileSizeBytes = 0;
  try {
    const s = await stat(filePath);
    fileSizeBytes = s.size;
  } catch {
    // If stat fails, use default timeout
  }

  // Large files would hang as a single base64 payload — delegate to HQ path with chunking
  if (fileSizeBytes > MAX_SINGLE_FILE_BYTES) {
    const { transcribeVoiceHQ } = await import("../transcribe/transcribeHQ.js");
    return transcribeVoiceHQ(filePath);
  }

  const timeoutMs = getTimeoutMs(fileSizeBytes);

  return callStt({
    filePath,
    prompt: TRANSCRIBE_PROMPT,
    timeoutMs,
    model: TRANSCRIBE_MODEL,
  });
}
