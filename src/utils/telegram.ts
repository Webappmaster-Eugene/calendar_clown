import type { Context } from "telegraf";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      splitIdx = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      splitIdx = remaining.lastIndexOf(". ", maxLength);
      if (splitIdx !== -1) splitIdx += 1;
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

export function getUserId(ctx: Context): string | null {
  const id = ctx.from?.id ?? ctx.chat?.id;
  return id != null ? String(id) : null;
}

export function getTelegramId(ctx: Context): number | null {
  return ctx.from?.id ?? null;
}

// Fall back to plain text so Telegram's "400: can't parse entities" can't crash the handler.
export async function replyMarkdownSafe(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.replyWithMarkdown(text);
  } catch {
    await ctx.reply(text.replace(/[*_`\[\]\\]/g, ""));
  }
}

export async function editMarkdownSafe(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await ctx.telegram.editMessageText(chatId, messageId, undefined, text, {
      parse_mode: "Markdown",
    });
  } catch {
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      text.replace(/[*_`\[\]\\]/g, "")
    );
  }
}
