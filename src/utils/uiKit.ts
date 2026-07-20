// ─── Text Truncation ─────────────────────────────────────────

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

// ─── Inline Button Labels ────────────────────────────────────

export const BTN_PREV = "⬅️ Назад";
export const BTN_NEXT = "Вперёд ➡️";

export const BTN_BACK = "◀️ Назад";
export function btnBackTo(label: string): string {
  return `◀️ Назад к ${label}`;
}

export const BTN_CANCEL = "❌ Отмена";
