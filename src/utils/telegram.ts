import type { Context } from "telegraf";

/** Maximum text length that Telegram allows in a single message. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Split a long text into chunks at paragraph or sentence boundaries. */
export function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a paragraph boundary
    let splitIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      // Try a single newline
      splitIdx = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      // Try a sentence boundary
      splitIdx = remaining.lastIndexOf(". ", maxLength);
      if (splitIdx !== -1) splitIdx += 1; // Include the period
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.3) {
      // Hard split at maxLength
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/** Extract Telegram user ID as string from context. Returns null if unavailable. */
export function getUserId(ctx: Context): string | null {
  const id = ctx.from?.id ?? ctx.chat?.id;
  return id != null ? String(id) : null;
}

/** Extract Telegram user ID as number from context. Returns null if unavailable. */
export function getTelegramId(ctx: Context): number | null {
  return ctx.from?.id ?? null;
}

/**
 * Reply with Markdown, falling back to plain text if Telegram rejects the message.
 * Prevents "400: can't parse entities" from crashing the handler.
 */
export async function replyMarkdownSafe(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.replyWithMarkdown(text);
  } catch {
    await ctx.reply(text.replace(/[*_`\[\]\\]/g, ""));
  }
}

/**
 * Edit message with Markdown, falling back to plain text on error.
 */
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
