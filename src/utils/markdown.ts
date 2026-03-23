/**
 * Escape special Markdown V1 characters to prevent Telegram API "can't parse entities" errors.
 * Applies to: * _ ` [ ]
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\[\]])/g, "\\$1");
}

/**
 * Escape special MarkdownV2 characters for Telegram API.
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Wrap text in Markdown bold with proper escaping of the inner text.
 */
export function safeBold(text: string): string {
  return `*${escapeMarkdown(text)}*`;
}
