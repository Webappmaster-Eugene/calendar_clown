/**
 * Current chat mode: calendar (meetings), openclaw (agent tasks), or send_message (send to other users).
 * Stored in-memory per chatId; default is "calendar".
 */

export type ChatMode = "calendar" | "openclaw" | "send_message";

const modes = new Map<string, ChatMode>();

export function getMode(chatId: string): ChatMode {
  return modes.get(chatId) ?? "calendar";
}

export function setMode(chatId: string, mode: ChatMode): void {
  modes.set(chatId, mode);
}
