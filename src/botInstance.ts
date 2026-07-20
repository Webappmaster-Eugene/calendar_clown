/**
 * Minimal bot instance registry.
 * Stores references to Telegraf bot send functions so they can be used
 * from API routes (e.g., broadcast, expense Excel delivery).
 */
import type { Telegraf } from "telegraf";

type SendMessageFn = (chatId: string | number, text: string) => Promise<unknown>;
export interface SendDocumentInput {
  source: Buffer;
  filename: string;
}
type SendDocumentFn = (
  chatId: string | number,
  doc: SendDocumentInput,
  extra?: { caption?: string }
) => Promise<unknown>;

let _sendMessage: SendMessageFn | null = null;
let _sendDocument: SendDocumentFn | null = null;
let _bot: Telegraf | null = null;

/** Full Telegraf instance — for flows needing bot.telegram directly (e.g. digest run). */
export function setBotInstance(bot: Telegraf): void {
  _bot = bot;
}

export function getBotInstance(): Telegraf | null {
  return _bot;
}

export function setBotSendMessage(fn: SendMessageFn): void {
  _sendMessage = fn;
}

export function getBotSendMessage(): SendMessageFn | null {
  return _sendMessage;
}

export function setBotSendDocument(fn: SendDocumentFn): void {
  _sendDocument = fn;
}

export function getBotSendDocument(): SendDocumentFn | null {
  return _sendDocument;
}
