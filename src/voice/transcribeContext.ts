import type { TranscribeContext } from "./transcribe.js";

// One mapping from a UI/bot mode name to the STT prompt, shared by the Mini App
// upload endpoint and the bot's voice handler. Anything that isn't clearly about
// calendar events, expenses or tasks gets the neutral "general" prompt: a
// topic-specific prompt biases the transcription of unrelated speech.
export function resolveTranscribeContext(mode: string | null | undefined): TranscribeContext {
  switch (mode?.trim().toLowerCase()) {
    case "calendar": return "calendar";
    case "expenses":
    case "expense": return "expense";
    case "tasks": return "tasks";
    default: return "general";
  }
}
