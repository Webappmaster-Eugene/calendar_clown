/**
 * Escape special Markdown V1 characters to prevent Telegram API "can't parse entities" errors.
 * Applies to: * _ ` [ ]
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\[\]])/g, "\\$1");
}

/**
 * Wrap text in Markdown bold with proper escaping of the inner text.
 */
export function safeBold(text: string): string {
  return `*${escapeMarkdown(text)}*`;
}
