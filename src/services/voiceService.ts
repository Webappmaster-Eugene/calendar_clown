/**
 * Voice processing business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 *
 * Note: The full voice pipeline (download OGG from Telegram, transcribe, extract intent,
 * create calendar event) requires Telegram file access. This service handles the parts
 * that can work with already-downloaded audio or pre-transcribed text.
 */
import { transcribeVoice } from "../voice/transcribe.js";
import type { TranscribeContext } from "../voice/transcribe.js";
import { extractVoiceIntent } from "../voice/extractVoiceIntent.js";
import type { VoiceIntent } from "../voice/extractVoiceIntent.js";
import { createLogger } from "../utils/logger.js";
import type { VoiceIntentType } from "../shared/types.js";

const log = createLogger("voice-service");

// ─── Types ────────────────────────────────────────────────────

export interface VoiceIntentResult {
  type: VoiceIntentType;
  events?: Array<{
    title: string;
    startISO: string;
    endISO: string;
    recurrence?: string[];
  }>;
  cancelQuery?: string;
  cancelDate?: string | null;
}

export interface TranscribeResult {
  transcript: string;
}

export interface TranscribeAndExtractResult {
  transcript: string;
  intent: VoiceIntentResult;
}

// ─── Helpers ──────────────────────────────────────────────────

function intentToResult(intent: VoiceIntent): VoiceIntentResult {
  if (intent.type === "calendar") {
    return {
      type: "calendar",
      events: intent.events.map((e) => ({
        title: e.title,
        startISO: e.start.toISOString(),
        endISO: e.end.toISOString(),
        recurrence: e.recurrence,
      })),
    };
  }

  if (intent.type === "cancel_event") {
    return {
      type: "cancel_event",
      cancelQuery: intent.query,
      cancelDate: intent.date?.toISOString() ?? null,
    };
  }

  return { type: intent.type };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Transcribe a local audio file to text.
 * @param filePath - path to OGG/audio file on disk
 * @param context - transcription context: "calendar" for calendar/expense modes, "general" for everything else
 */
export async function transcribeAudio(filePath: string, context: TranscribeContext = "calendar"): Promise<TranscribeResult> {
  const transcript = await transcribeVoice(filePath, context);
  if (!transcript || transcript.trim().length === 0) {
    throw new Error("Не удалось распознать голосовое сообщение.");
  }
  return { transcript: transcript.trim() };
}

/**
 * Extract intent from transcribed text.
 * Returns the intent type and extracted fields.
 */
export async function extractIntent(transcript: string): Promise<VoiceIntentResult> {
  const result = await extractVoiceIntent(transcript);
  return intentToResult(result);
}

/**
 * Full pipeline: transcribe audio file and extract intent.
 * @param filePath - path to OGG/audio file on disk
 */
export async function transcribeAndExtract(filePath: string): Promise<TranscribeAndExtractResult> {
  const { transcript } = await transcribeAudio(filePath);
  const intent = await extractIntent(transcript);
  return { transcript, intent };
}
