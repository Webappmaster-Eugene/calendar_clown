export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\[\]])/g, "\\$1");
}

/**
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
