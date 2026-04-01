/**
 * Shared UI Kit — единые константы и утилиты для inline-кнопок бота.
 * Все режимы должны использовать эти константы для консистентного UX.
 */

// ─── Text Truncation ─────────────────────────────────────────

/** Обрезка текста с добавлением "…" если превышен maxLen. */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

// ─── Inline Button Labels ────────────────────────────────────

/** Pagination — листание страниц списка */
export const BTN_PREV = "⬅️ Назад";
export const BTN_NEXT = "Вперёд ➡️";

/** Contextual back — возврат к родительскому представлению */
export const BTN_BACK = "◀️ Назад";
export function btnBackTo(label: string): string {
  return `◀️ Назад к ${label}`;
}

/** Destructive actions */
export const BTN_DELETE = "🗑 Удалить";
export const BTN_CANCEL = "❌ Отмена";

/** Confirmation */
export const BTN_CONFIRM_DELETE = "✅ Да, удалить";

/** Edit */
export const BTN_EDIT = "✏️ Изменить";
