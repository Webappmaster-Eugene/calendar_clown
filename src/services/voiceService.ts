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
import type { VoiceIntentType } from "../shared/types.js";

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
  listFrom?: string;
  listDays?: number;
  listLabel?: string;
}

export interface TranscribeResult {
  transcript: string;
}

export interface TranscribeAndExtractResult {
  transcript: string;
  intent: VoiceIntentResult;
}

// ─── Helpers ──────────────────────────────────────────────────

// Exported for unit testing (pure mapping of the LLM intent to the API DTO).
export function intentToResult(intent: VoiceIntent): VoiceIntentResult {
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

  if (intent.type === "list_range") {
    return {
      type: "list_range",
      listFrom: intent.from.toISOString(),
      listDays: intent.days,
      listLabel: intent.label,
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

export async function extractIntent(transcript: string): Promise<VoiceIntentResult> {
  const result = await extractVoiceIntent(transcript);
  return intentToResult(result);
}
