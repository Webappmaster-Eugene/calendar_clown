/**
 * In-memory session storage for OpenClaw chat: history per chat, limited to last N exchanges.
 */

const MAX_TURN_PAIRS = 10;

type SessionMessage = { role: "user" | "assistant"; content: string };

const sessions = new Map<string, { messages: SessionMessage[] }>();

export function isActive(chatId: string): boolean {
  return sessions.has(chatId);
}

export function getOrCreate(chatId: string): SessionMessage[] {
  let session = sessions.get(chatId);
  if (!session) {
    session = { messages: [] };
    sessions.set(chatId, session);
  }
  return session.messages;
}

export function appendUser(chatId: string, text: string): void {
  const messages = getOrCreate(chatId);
  messages.push({ role: "user", content: text });
  trimToLastPairs(chatId);
}

export function appendAssistant(chatId: string, text: string): void {
  const messages = getOrCreate(chatId);
  messages.push({ role: "assistant", content: text });
  trimToLastPairs(chatId);
}

export function clear(chatId: string): void {
  sessions.delete(chatId);
}

function trimToLastPairs(chatId: string): void {
  const session = sessions.get(chatId);
  if (!session) return;
  const messages = session.messages;
  if (messages.length <= MAX_TURN_PAIRS * 2) return;
  session.messages = messages.slice(-MAX_TURN_PAIRS * 2);
}
