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
