/**
 * Minimal bot instance registry.
 * Stores a reference to the Telegraf bot's sendMessage function
 * so it can be used from API routes (e.g., broadcast).
 */

type SendMessageFn = (chatId: string | number, text: string) => Promise<unknown>;

let _sendMessage: SendMessageFn | null = null;

export function setBotSendMessage(fn: SendMessageFn): void {
  _sendMessage = fn;
}

export function getBotSendMessage(): SendMessageFn | null {
  return _sendMessage;
}
