// Telegram caps a text message at 4096 UTF-16 code units, and savePreparedInlineMessage
// validates that at save time — so an AI answer has to be cut before it is offered.

export const TELEGRAM_SHARE_MAX_LENGTH = 4096;

const TRUNCATION_NOTE = "\n\n… Текст сокращён. Полный ответ — в мини-приложении.";

export interface ShareText {
  text: string;
  truncated: boolean;
}

/** Cuts at the last paragraph/sentence boundary that fits, never between the two
 *  halves of a surrogate pair (which would produce a broken character). */
export function buildShareMessageText(
  content: string,
  opts: { maxLength?: number } = {}
): ShareText {
  const maxLength = opts.maxLength ?? TELEGRAM_SHARE_MAX_LENGTH;
  const text = content.trim();
  if (text.length <= maxLength) return { text, truncated: false };

  const budget = maxLength - TRUNCATION_NOTE.length;
  if (budget <= 0) return { text: text.slice(0, maxLength), truncated: true };

  let cut = budget;
  const window = text.slice(0, budget);
  const paragraph = window.lastIndexOf("\n\n");
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"));
  const newline = window.lastIndexOf("\n");

  // Only accept a boundary that keeps most of the budget, else a single long
  // paragraph would be cut to almost nothing.
  const minAcceptable = Math.floor(budget * 0.5);
  for (const candidate of [paragraph, sentence, newline]) {
    if (candidate >= minAcceptable) {
      cut = candidate + (candidate === sentence ? 1 : 0);
      break;
    }
  }

  // Don't split a surrogate pair.
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;

  return { text: text.slice(0, cut).trimEnd() + TRUNCATION_NOTE, truncated: true };
}
