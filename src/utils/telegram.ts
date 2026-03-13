import type { Context } from "telegraf";

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
