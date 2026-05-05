/**
 * Minimal bot instance registry.
 * Stores references to Telegraf bot send functions so they can be used
 * from API routes (e.g., broadcast, expense Excel delivery).
 */

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
