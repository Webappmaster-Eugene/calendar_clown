/**
 * Reusable bulk selection UI for Telegram inline keyboards.
 * Used across admin data management for bulk delete operations.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { createLogger } from "./logger.js";

const log = createLogger("bulk-select");

export interface BulkSelectItem {
  id: number;
  label: string;
  selected: boolean;
}

export interface BulkSelectState {
  mode: string;
  items: BulkSelectItem[];
  page: number;
  pageSize: number;
  onExecute: (ids: number[]) => Promise<number>;
  timestamp: number;
}

const bulkStates = new Map<number, BulkSelectState>();

const BULK_TTL = 10 * 60 * 1000; // 10 minutes

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, val] of bulkStates) {
    if (now - val.timestamp > BULK_TTL) bulkStates.delete(key);
  }
}

/** Initialize a bulk select session and send the first page. */
export async function initBulkSelect(
  ctx: Context,
  telegramId: number,
  mode: string,
  items: Array<{ id: number; label: string }>,
  onExecute: (ids: number[]) => Promise<number>,
  pageSize: number = 8
): Promise<void> {
  cleanExpired();

  if (items.length === 0) {
    await ctx.editMessageText("Нет элементов для выбора.");
    return;
  }

  const state: BulkSelectState = {
    mode,
    items: items.map((i) => ({ ...i, selected: false })),
    page: 0,
    pageSize,
    onExecute,
    timestamp: Date.now(),
  };

  bulkStates.set(telegramId, state);
  await sendBulkPage(ctx, state, true);
}

/** Build and send the bulk selection keyboard. */
async function sendBulkPage(
  ctx: Context,
  state: BulkSelectState,
  editExisting: boolean
): Promise<void> {
  const totalPages = Math.ceil(state.items.length / state.pageSize);
  const start = state.page * state.pageSize;
  const end = Math.min(start + state.pageSize, state.items.length);
  const pageItems = state.items.slice(start, end);

  const selectedCount = state.items.filter((i) => i.selected).length;
  const allOnPage = pageItems.every((i) => i.selected);

  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Item toggle buttons
  for (const item of pageItems) {
    const check = item.selected ? "☑️" : "⬜";
    const label = `${check} ${item.label}`.slice(0, 60);
    rows.push([Markup.button.callback(label, `bulk:tog:${item.id}`)]);
  }

  // Select All / Deselect All on page
  const toggleAllLabel = allOnPage ? "◻️ Снять всё на странице" : "☑️ Выбрать всё на странице";
  rows.push([Markup.button.callback(toggleAllLabel, "bulk:all")]);

  // Pagination
  const paginationRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (state.page > 0) {
    paginationRow.push(Markup.button.callback("⬅️", `bulk:pg:${state.page - 1}`));
  }
  if (state.page < totalPages - 1) {
    paginationRow.push(Markup.button.callback("➡️", `bulk:pg:${state.page + 1}`));
  }
  if (paginationRow.length > 0) {
    rows.push(paginationRow);
  }

  // Execute & Cancel
  const actionRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (selectedCount > 0) {
    actionRow.push(Markup.button.callback(`🗑 Удалить (${selectedCount})`, "bulk:exec"));
  }
  actionRow.push(Markup.button.callback("❌ Отмена", "bulk:cancel"));
  rows.push(actionRow);

  const text = `📋 *Выберите элементы для удаления*\n` +
    `Страница ${state.page + 1}/${totalPages} · Выбрано: ${selectedCount}/${state.items.length}`;

  const keyboard = Markup.inlineKeyboard(rows);

  if (editExisting) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
  }
}

/** Handle all `bulk:*` callbacks. */
export async function handleBulkCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  cleanExpired();
  const state = bulkStates.get(telegramId);
  if (!state) {
    await ctx.answerCbQuery("Сессия истекла. Начните заново.");
    return;
  }

  try {
    // Toggle single item
    const togMatch = data.match(/^bulk:tog:(\d+)$/);
    if (togMatch) {
      const itemId = parseInt(togMatch[1], 10);
      const item = state.items.find((i) => i.id === itemId);
      if (item) {
        item.selected = !item.selected;
      }
      await sendBulkPage(ctx, state, true);
      await ctx.answerCbQuery();
      return;
    }

    // Toggle all on current page
    if (data === "bulk:all") {
      const start = state.page * state.pageSize;
      const end = Math.min(start + state.pageSize, state.items.length);
      const pageItems = state.items.slice(start, end);
      const allSelected = pageItems.every((i) => i.selected);
      for (const item of pageItems) {
        item.selected = !allSelected;
      }
      await sendBulkPage(ctx, state, true);
      await ctx.answerCbQuery();
      return;
    }

    // Pagination
    const pgMatch = data.match(/^bulk:pg:(\d+)$/);
    if (pgMatch) {
      state.page = parseInt(pgMatch[1], 10);
      await sendBulkPage(ctx, state, true);
      await ctx.answerCbQuery();
      return;
    }

    // Execute — show confirmation
    if (data === "bulk:exec") {
      const selectedCount = state.items.filter((i) => i.selected).length;
      if (selectedCount === 0) {
        await ctx.answerCbQuery("Ничего не выбрано.");
        return;
      }
      await ctx.editMessageText(
        `⚠️ *Подтвердите удаление*\n\nВыбрано элементов: *${selectedCount}*\n\nЭто действие необратимо.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Да, удалить", "bulk:exec_yes")],
            [Markup.button.callback("❌ Отмена", "bulk:cancel")],
          ]),
        }
      );
      await ctx.answerCbQuery();
      return;
    }

    // Execute confirmed
    if (data === "bulk:exec_yes") {
      const selectedIds = state.items.filter((i) => i.selected).map((i) => i.id);
      if (selectedIds.length === 0) {
        await ctx.answerCbQuery("Ничего не выбрано.");
        bulkStates.delete(telegramId);
        return;
      }

      try {
        const deleted = await state.onExecute(selectedIds);
        bulkStates.delete(telegramId);
        await ctx.editMessageText(`✅ Удалено записей: ${deleted}`);
      } catch (err) {
        log.error("Bulk delete error:", err);
        bulkStates.delete(telegramId);
        await ctx.editMessageText("❌ Ошибка при массовом удалении.");
      }
      await ctx.answerCbQuery();
      return;
    }

    // Cancel
    if (data === "bulk:cancel") {
      bulkStates.delete(telegramId);
      await ctx.editMessageText("Операция отменена.");
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
  } catch (err) {
    log.error("Bulk callback error:", err);
    await ctx.answerCbQuery("Ошибка.");
  }
}
