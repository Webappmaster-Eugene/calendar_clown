/**
 * Current chat mode: calendar (meetings) or openclaw (agent tasks).
 * Stored in-memory per chatId; default is "calendar".
 */

export type ChatMode = "calendar" | "openclaw";

const modes = new Map<string, ChatMode>();

export function getMode(chatId: string): ChatMode {
  return modes.get(chatId) ?? "calendar";
}

export function setMode(chatId: string, mode: ChatMode): void {
  modes.set(chatId, mode);
}
