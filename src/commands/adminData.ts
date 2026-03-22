/**
 * Admin Data Management — central handler for all admin data CRUD operations.
 * Handles callbacks matching `adm_*:*` pattern.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { initBulkSelect } from "../utils/bulkSelect.js";
import { createLogger } from "../utils/logger.js";

// ─── Repository imports ────────────────────────────────────────────────

import {
  getAllTranscriptionsPaginated,
  countAllTranscriptions,
  deleteTranscription,
  bulkDeleteTranscriptions,
  deleteAllTranscriptions,
} from "../transcribe/repository.js";

import {
  getExpensesPaginated,
  countExpenses,
  updateExpense,
  bulkDeleteExpenses,
  deleteAllExpenses,
} from "../expenses/repository.js";

import {
  getAllEntriesPaginated,
  countAllEntries,
  updateEntryFields,
  bulkDeleteEntries,
  deleteAllEntries,
} from "../gandalf/repository.js";

import {
  getAllRubricsPaginated,
  countAllRubrics,
  updateRubric,
  bulkDeleteRubrics,
  deleteAllRubrics,
} from "../digest/repository.js";

import {
  getAllDatesPaginated,
  countAllDates,
  bulkDeleteDates,
  deleteAllDates,
  removeNotableDate,
} from "../notable-dates/repository.js";

import {
  getAllEventsPaginated,
  countAllEvents,
  bulkDeleteEvents,
  deleteAllEvents,
} from "../calendar/repository.js";

import {
  getAllDialogsPaginated,
  countAllDialogs,
  bulkDeleteDialogs,
  deleteAllDialogs,
} from "../chat/repository.js";

import {
  getAllWishlistsPaginated,
  countAllWishlists,
  bulkDeleteWishlists,
  deleteAllWishlists,
} from "../wishlist/repository.js";

import {
  getAllGoalSetsPaginated,
  countAllGoalSets,
  bulkDeleteGoalSets,
  deleteAllGoalSets,
} from "../goals/repository.js";

import {
  getAllRemindersPaginated,
  countAllReminders,
  bulkDeleteReminders,
  deleteAllReminders,
} from "../reminders/repository.js";

import {
  getAllSearchesPaginated,
  countAllSearches,
  bulkDeleteSearches,
  deleteAllSearches,
} from "../osint/repository.js";

import {
  getAllWorkplacesPaginated,
  countAllWorkplaces,
  bulkDeleteWorkplaces,
  deleteAllWorkplaces,
} from "../summarizer/repository.js";

import {
  getAllChannelsPaginated,
  countAllChannels,
  bulkDeleteChannels,
  deleteAllChannels,
} from "../blogger/repository.js";

const log = createLogger("admin-data");

const PAGE_SIZE = 5;

// ─── Pending text input state ──────────────────────────────────────────

type AdminDataPendingAction =
  | { type: "edit_expense"; expenseId: number; timestamp: number }
  | { type: "edit_gandalf"; entryId: number; timestamp: number }
  | { type: "edit_rubric"; rubricId: number; timestamp: number };

const adminDataPendingAction = new Map<number, AdminDataPendingAction>();

function cleanExpiredPending(): void {
  const now = Date.now();
  const TTL = 5 * 60 * 1000;
  for (const [key, val] of adminDataPendingAction) {
    if (now - val.timestamp > TTL) adminDataPendingAction.delete(key);
  }
}

// ─── Data Management Menu ──────────────────────────────────────────────

/** Show the data management submenu. Called from admin:data callback. */
export async function showDataManagementMenu(ctx: Context): Promise<void> {
  await ctx.editMessageText("📊 *Управление данными*\n\nВыберите раздел:", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("💰 Расходы", "adm_exp:menu")],
      [Markup.button.callback("🎙 Транскрипции", "adm_tr:menu")],
      [Markup.button.callback("📰 Дайджест", "adm_dig:menu")],
      [Markup.button.callback("📚 База знаний", "adm_gand:menu")],
      [Markup.button.callback("🎉 Даты", "adm_date:menu")],
      [Markup.button.callback("📅 Календарь", "adm_cal:menu")],
      [Markup.button.callback("🧠 Нейро-диалоги", "adm_chat:menu")],
      [Markup.button.callback("🎁 Вишлисты", "adm_wish:menu")],
      [Markup.button.callback("🎯 Цели", "adm_goal:menu")],
      [Markup.button.callback("⏰ Напоминания", "adm_rem:menu")],
      [Markup.button.callback("🔍 OSINT", "adm_osint:menu")],
      [Markup.button.callback("📝 Саммаризатор", "adm_sum:menu")],
      [Markup.button.callback("✍️ Блогер", "adm_blog:menu")],
      [Markup.button.callback("◀️ Назад", "admin:back")],
    ]),
  });
}

// ─── Main callback handler ─────────────────────────────────────────────

/** Handle all admin data management callbacks (adm_*:*). */
export async function handleAdminDataCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;

  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.answerCbQuery("Доступ запрещён.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery("БД недоступна.");
    return;
  }

  try {
    // Route by prefix
    if (data.startsWith("adm_tr:")) {
      await handleTranscriptions(ctx, data, telegramId);
    } else if (data.startsWith("adm_exp:")) {
      await handleExpenses(ctx, data, telegramId);
    } else if (data.startsWith("adm_gand:")) {
      await handleGandalf(ctx, data, telegramId);
    } else if (data.startsWith("adm_dig:")) {
      await handleDigest(ctx, data, telegramId);
    } else if (data.startsWith("adm_date:")) {
      await handleDates(ctx, data, telegramId);
    } else if (data.startsWith("adm_cal:")) {
      await handleCalendar(ctx, data, telegramId);
    } else if (data.startsWith("adm_chat:")) {
      await handleChatDialogs(ctx, data, telegramId);
    } else if (data.startsWith("adm_wish:")) {
      await handleWishlists(ctx, data, telegramId);
    } else if (data.startsWith("adm_goal:")) {
      await handleGoalSets(ctx, data, telegramId);
    } else if (data.startsWith("adm_rem:")) {
      await handleRemindersAdmin(ctx, data, telegramId);
    } else if (data.startsWith("adm_osint:")) {
      await handleOsintSearches(ctx, data, telegramId);
    } else if (data.startsWith("adm_sum:")) {
      await handleWorkplaces(ctx, data, telegramId);
    } else if (data.startsWith("adm_blog:")) {
      await handleBlogChannels(ctx, data, telegramId);
    }
    await ctx.answerCbQuery();
  } catch (err) {
    log.error("Admin data callback error:", err);
    await ctx.answerCbQuery("Ошибка.");
  }
}

/** Handle admin data text input (edit operations). Returns true if consumed. */
export async function handleAdminDataTextInput(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) return false;

  cleanExpiredPending();
  const pending = adminDataPendingAction.get(telegramId);
  if (!pending) return false;

  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text.trim();
  adminDataPendingAction.delete(telegramId);

  try {
    if (pending.type === "edit_expense") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Некорректная сумма.");
        return true;
      }
      const updated = await updateExpense(pending.expenseId, { amount });
      await ctx.reply(updated ? `✅ Расход #${pending.expenseId} обновлён. Новая сумма: ${amount}` : "❌ Расход не найден.");
      return true;
    }

    if (pending.type === "edit_gandalf") {
      if (!text) {
        await ctx.reply("❌ Пустой текст.");
        return true;
      }
      // Parse "title" or "title|price"
      const parts = text.split("|").map((s) => s.trim());
      const fields: { title?: string; price?: number | null } = {};
      if (parts[0]) fields.title = parts[0];
      if (parts.length > 1) {
        const price = parseFloat(parts[1]);
        fields.price = isNaN(price) ? null : price;
      }
      const updated = await updateEntryFields(pending.entryId, fields);
      await ctx.reply(updated ? `✅ Запись #${pending.entryId} обновлена.` : "❌ Запись не найдена.");
      return true;
    }

    if (pending.type === "edit_rubric") {
      if (!text) {
        await ctx.reply("❌ Пустой текст.");
        return true;
      }
      const updated = await updateRubric(pending.rubricId, { name: text });
      await ctx.reply(updated ? `✅ Рубрика #${pending.rubricId} обновлена.` : "❌ Рубрика не найдена.");
      return true;
    }
  } catch (err) {
    log.error("Admin data text input error:", err);
    await ctx.reply("❌ Ошибка при обработке.");
  }

  return true;
}

// ─── Transcriptions ────────────────────────────────────────────────────

async function handleTranscriptions(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_tr:menu") {
    await showModeMenu(ctx, "🎙 Транскрипции", "adm_tr");
    return;
  }

  const listMatch = data.match(/^adm_tr:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllTranscriptions();
    const items = await getAllTranscriptionsPaginated(PAGE_SIZE, offset);
    const lines = items.map((t, i) => {
      const num = offset + i + 1;
      const date = t.createdAt.toLocaleDateString("ru-RU");
      const preview = t.transcript ? t.transcript.slice(0, 50) + (t.transcript.length > 50 ? "…" : "") : "(нет)";
      return `*${num}.* ${t.firstName} · ${date} · ${t.status}\n${preview}`;
    });
    await showPaginatedList(ctx, "🎙 Транскрипции", lines, total, offset, "adm_tr", items.map((t) => t.id));
    return;
  }

  const delMatch = data.match(/^adm_tr:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "транскрипцию", id, "adm_tr");
    return;
  }

  const delYesMatch = data.match(/^adm_tr:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await deleteTranscription(id);
    await ctx.editMessageText(`✅ Транскрипция #${id} удалена.`);
    return;
  }

  if (data === "adm_tr:bulk") {
    const items = await getAllTranscriptionsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "transcriptions",
      items.map((t) => ({
        id: t.id,
        label: `${t.firstName}: ${(t.transcript ?? "").slice(0, 30) || t.status}`,
      })),
      bulkDeleteTranscriptions
    );
    return;
  }

  if (data === "adm_tr:delall") {
    const count = await countAllTranscriptions();
    await showDeleteAllConfirm(ctx, "транскрипции", count, "adm_tr");
    return;
  }

  if (data === "adm_tr:delall_yes") {
    const deleted = await deleteAllTranscriptions();
    await ctx.editMessageText(`✅ Удалено транскрипций: ${deleted}`);
    return;
  }
}

// ─── Expenses ──────────────────────────────────────────────────────────

async function handleExpenses(ctx: Context, data: string, telegramId: number): Promise<void> {
  const admin = await getUserByTelegramId(telegramId);
  const tribeId = admin?.tribeId ?? 1;

  if (data === "adm_exp:menu") {
    await showModeMenu(ctx, "💰 Расходы", "adm_exp", true);
    return;
  }

  const listMatch = data.match(/^adm_exp:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countExpenses(tribeId);
    const items = await getExpensesPaginated(tribeId, PAGE_SIZE, offset);
    const lines = items.map((e, i) => {
      const num = offset + i + 1;
      const date = e.createdAt.toLocaleDateString("ru-RU");
      return `*${num}.* ${e.categoryEmoji} ${e.categoryName}: ${e.amount}₽ · ${e.firstName} · ${date}`;
    });
    await showPaginatedList(ctx, "💰 Расходы", lines, total, offset, "adm_exp", items.map((e) => e.id));
    return;
  }

  const delMatch = data.match(/^adm_exp:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "расход", id, "adm_exp");
    return;
  }

  const delYesMatch = data.match(/^adm_exp:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    // Admin delete: no ownership check
    const { query } = await import("../db/connection.js");
    await query("DELETE FROM expenses WHERE id = $1", [id]);
    await ctx.editMessageText(`✅ Расход #${id} удалён.`);
    return;
  }

  const editMatch = data.match(/^adm_exp:edit:(\d+)$/);
  if (editMatch) {
    const id = parseInt(editMatch[1], 10);
    cleanExpiredPending();
    adminDataPendingAction.set(telegramId, { type: "edit_expense", expenseId: id, timestamp: Date.now() });
    await ctx.editMessageText(`✏️ Введите новую сумму для расхода #${id}:`);
    return;
  }

  if (data === "adm_exp:bulk") {
    const items = await getExpensesPaginated(tribeId, 100, 0);
    await initBulkSelect(
      ctx, telegramId, "expenses",
      items.map((e) => ({
        id: e.id,
        label: `${e.categoryEmoji} ${e.amount}₽ ${e.firstName}`,
      })),
      bulkDeleteExpenses
    );
    return;
  }

  if (data === "adm_exp:delall") {
    const count = await countExpenses(tribeId);
    await showDeleteAllConfirm(ctx, "расходы", count, "adm_exp");
    return;
  }

  if (data === "adm_exp:delall_yes") {
    const deleted = await deleteAllExpenses(tribeId);
    await ctx.editMessageText(`✅ Удалено расходов: ${deleted}`);
    return;
  }
}

// ─── Gandalf (База знаний) ───────────────────────────────────────────

async function handleGandalf(ctx: Context, data: string, telegramId: number): Promise<void> {
  const admin = await getUserByTelegramId(telegramId);
  const tribeId = admin?.tribeId ?? 1;

  if (data === "adm_gand:menu") {
    await showModeMenu(ctx, "📚 База знаний", "adm_gand", true);
    return;
  }

  const listMatch = data.match(/^adm_gand:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllEntries(tribeId);
    const items = await getAllEntriesPaginated(PAGE_SIZE, offset);
    const lines = items.map((e, i) => {
      const num = offset + i + 1;
      const price = e.price != null ? ` ${e.price}₽` : "";
      return `*${num}.* ${e.categoryEmoji ?? "📁"} ${e.title}${price} · ${e.addedByName ?? "—"}`;
    });
    await showPaginatedList(ctx, "📚 База знаний", lines, total, offset, "adm_gand", items.map((e) => e.id));
    return;
  }

  const delMatch = data.match(/^adm_gand:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "запись", id, "adm_gand");
    return;
  }

  const delYesMatch = data.match(/^adm_gand:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    const { query } = await import("../db/connection.js");
    await query("DELETE FROM gandalf_entries WHERE id = $1", [id]);
    await ctx.editMessageText(`✅ Запись #${id} удалена.`);
    return;
  }

  const editMatch = data.match(/^adm_gand:edit:(\d+)$/);
  if (editMatch) {
    const id = parseInt(editMatch[1], 10);
    cleanExpiredPending();
    adminDataPendingAction.set(telegramId, { type: "edit_gandalf", entryId: id, timestamp: Date.now() });
    await ctx.editMessageText(`✏️ Введите новое название (или «название|цена») для записи #${id}:`);
    return;
  }

  if (data === "adm_gand:bulk") {
    const items = await getAllEntriesPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "gandalf",
      items.map((e) => ({
        id: e.id,
        label: `${e.categoryEmoji ?? "📁"} ${e.title}`,
      })),
      bulkDeleteEntries
    );
    return;
  }

  if (data === "adm_gand:delall") {
    const count = await countAllEntries(tribeId);
    await showDeleteAllConfirm(ctx, "записи Базы знаний", count, "adm_gand");
    return;
  }

  if (data === "adm_gand:delall_yes") {
    const deleted = await deleteAllEntries(tribeId);
    await ctx.editMessageText(`✅ Удалено записей: ${deleted}`);
    return;
  }
}

// ─── Digest ────────────────────────────────────────────────────────────

async function handleDigest(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_dig:menu") {
    await showModeMenu(ctx, "📰 Дайджест", "adm_dig", true);
    return;
  }

  const listMatch = data.match(/^adm_dig:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllRubrics();
    const items = await getAllRubricsPaginated(PAGE_SIZE, offset);
    const lines = items.map((r, i) => {
      const num = offset + i + 1;
      const emoji = r.emoji ?? "📰";
      const active = r.isActive ? "✅" : "⏸";
      return `*${num}.* ${emoji} ${r.name} · ${r.firstName} ${active}`;
    });
    await showPaginatedList(ctx, "📰 Дайджест", lines, total, offset, "adm_dig", items.map((r) => r.id));
    return;
  }

  const delMatch = data.match(/^adm_dig:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "рубрику", id, "adm_dig");
    return;
  }

  const delYesMatch = data.match(/^adm_dig:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    const { query } = await import("../db/connection.js");
    await query("DELETE FROM digest_rubrics WHERE id = $1", [id]);
    await ctx.editMessageText(`✅ Рубрика #${id} удалена.`);
    return;
  }

  const editMatch = data.match(/^adm_dig:edit:(\d+)$/);
  if (editMatch) {
    const id = parseInt(editMatch[1], 10);
    cleanExpiredPending();
    adminDataPendingAction.set(telegramId, { type: "edit_rubric", rubricId: id, timestamp: Date.now() });
    await ctx.editMessageText(`✏️ Введите новое название для рубрики #${id}:`);
    return;
  }

  if (data === "adm_dig:bulk") {
    const items = await getAllRubricsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "digest",
      items.map((r) => ({
        id: r.id,
        label: `${r.emoji ?? "📰"} ${r.name} (${r.firstName})`,
      })),
      bulkDeleteRubrics
    );
    return;
  }

  if (data === "adm_dig:delall") {
    const count = await countAllRubrics();
    await showDeleteAllConfirm(ctx, "рубрики", count, "adm_dig");
    return;
  }

  if (data === "adm_dig:delall_yes") {
    const deleted = await deleteAllRubrics();
    await ctx.editMessageText(`✅ Удалено рубрик: ${deleted}`);
    return;
  }
}

// ─── Notable Dates ─────────────────────────────────────────────────────

async function handleDates(ctx: Context, data: string, telegramId: number): Promise<void> {
  const admin = await getUserByTelegramId(telegramId);
  const tribeId = admin?.tribeId ?? 1;

  if (data === "adm_date:menu") {
    await showModeMenu(ctx, "🎉 Даты", "adm_date");
    return;
  }

  const listMatch = data.match(/^adm_date:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllDates(tribeId);
    const items = await getAllDatesPaginated(PAGE_SIZE, offset);
    const lines = items.map((d, i) => {
      const num = offset + i + 1;
      const dateStr = `${d.dateDay.toString().padStart(2, "0")}.${d.dateMonth.toString().padStart(2, "0")}`;
      return `*${num}.* ${d.emoji} ${d.name} — ${dateStr}`;
    });
    await showPaginatedList(ctx, "🎉 Даты", lines, total, offset, "adm_date", items.map((d) => d.id));
    return;
  }

  const delMatch = data.match(/^adm_date:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "дату", id, "adm_date");
    return;
  }

  const delYesMatch = data.match(/^adm_date:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await removeNotableDate(id, tribeId);
    await ctx.editMessageText(`✅ Дата #${id} удалена.`);
    return;
  }

  if (data === "adm_date:bulk") {
    const items = await getAllDatesPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "dates",
      items.map((d) => ({
        id: d.id,
        label: `${d.emoji} ${d.name} (${d.dateDay}.${d.dateMonth})`,
      })),
      bulkDeleteDates
    );
    return;
  }

  if (data === "adm_date:delall") {
    const count = await countAllDates(tribeId);
    await showDeleteAllConfirm(ctx, "даты", count, "adm_date");
    return;
  }

  if (data === "adm_date:delall_yes") {
    const deleted = await deleteAllDates(tribeId);
    await ctx.editMessageText(`✅ Удалено дат: ${deleted}`);
    return;
  }
}

// ─── Calendar ──────────────────────────────────────────────────────────

async function handleCalendar(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_cal:menu") {
    await showModeMenu(ctx, "📅 Календарь", "adm_cal");
    return;
  }

  const listMatch = data.match(/^adm_cal:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllEvents();
    const items = await getAllEventsPaginated(PAGE_SIZE, offset);
    const lines = items.map((e, i) => {
      const num = offset + i + 1;
      const date = e.startTime.toLocaleDateString("ru-RU");
      const status = e.status === "deleted" ? "🗑" : "✅";
      return `*${num}.* ${status} ${e.summary} · ${e.firstName} · ${date}`;
    });
    await showPaginatedList(ctx, "📅 Календарь", lines, total, offset, "adm_cal", items.map((e) => e.id));
    return;
  }

  const delMatch = data.match(/^adm_cal:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "событие", id, "adm_cal");
    return;
  }

  const delYesMatch = data.match(/^adm_cal:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteEvents([id]);
    await ctx.editMessageText(`✅ Событие #${id} помечено удалённым.`);
    return;
  }

  if (data === "adm_cal:bulk") {
    const items = await getAllEventsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "calendar",
      items.map((e) => ({
        id: e.id,
        label: `${e.summary} (${e.firstName})`,
      })),
      bulkDeleteEvents
    );
    return;
  }

  if (data === "adm_cal:delall") {
    const count = await countAllEvents();
    await showDeleteAllConfirm(ctx, "события календаря", count, "adm_cal");
    return;
  }

  if (data === "adm_cal:delall_yes") {
    const deleted = await deleteAllEvents();
    await ctx.editMessageText(`✅ Помечено удалёнными: ${deleted}`);
    return;
  }
}

// ─── Chat Dialogs ─────────────────────────────────────────────────────

async function handleChatDialogs(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_chat:menu") {
    await showModeMenu(ctx, "🧠 Нейро-диалоги", "adm_chat");
    return;
  }

  const listMatch = data.match(/^adm_chat:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllDialogs();
    const items = await getAllDialogsPaginated(PAGE_SIZE, offset);
    const lines = items.map((d, i) => {
      const num = offset + i + 1;
      const date = d.createdAt.toLocaleDateString("ru-RU");
      const title = d.title || "Без названия";
      return `*${num}.* ${d.firstName} · ${title} · ${date}`;
    });
    await showPaginatedList(ctx, "🧠 Нейро-диалоги", lines, total, offset, "adm_chat", items.map((d) => d.id));
    return;
  }

  const delMatch = data.match(/^adm_chat:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "диалог", id, "adm_chat");
    return;
  }

  const delYesMatch = data.match(/^adm_chat:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteDialogs([id]);
    await ctx.editMessageText(`✅ Диалог #${id} удалён.`);
    return;
  }

  if (data === "adm_chat:bulk") {
    const items = await getAllDialogsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "chat_dialogs",
      items.map((d) => ({
        id: d.id,
        label: `${d.firstName}: ${d.title || "Без названия"}`,
      })),
      bulkDeleteDialogs
    );
    return;
  }

  if (data === "adm_chat:delall") {
    const count = await countAllDialogs();
    await showDeleteAllConfirm(ctx, "нейро-диалоги", count, "adm_chat");
    return;
  }

  if (data === "adm_chat:delall_yes") {
    const deleted = await deleteAllDialogs();
    await ctx.editMessageText(`✅ Удалено диалогов: ${deleted}`);
    return;
  }
}

// ─── Wishlists ────────────────────────────────────────────────────────

async function handleWishlists(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_wish:menu") {
    await showModeMenu(ctx, "🎁 Вишлисты", "adm_wish");
    return;
  }

  const listMatch = data.match(/^adm_wish:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllWishlists();
    const items = await getAllWishlistsPaginated(PAGE_SIZE, offset);
    const lines = items.map((w, i) => {
      const num = offset + i + 1;
      const date = w.createdAt.toLocaleDateString("ru-RU");
      return `*${num}.* ${w.name} (${w.itemCount} предм.) · ${w.firstName} · ${date}`;
    });
    await showPaginatedList(ctx, "🎁 Вишлисты", lines, total, offset, "adm_wish", items.map((w) => w.id));
    return;
  }

  const delMatch = data.match(/^adm_wish:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "вишлист", id, "adm_wish");
    return;
  }

  const delYesMatch = data.match(/^adm_wish:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteWishlists([id]);
    await ctx.editMessageText(`✅ Вишлист #${id} удалён.`);
    return;
  }

  if (data === "adm_wish:bulk") {
    const items = await getAllWishlistsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "wishlists",
      items.map((w) => ({
        id: w.id,
        label: `${w.name} (${w.firstName})`,
      })),
      bulkDeleteWishlists
    );
    return;
  }

  if (data === "adm_wish:delall") {
    const count = await countAllWishlists();
    await showDeleteAllConfirm(ctx, "вишлисты", count, "adm_wish");
    return;
  }

  if (data === "adm_wish:delall_yes") {
    const deleted = await deleteAllWishlists();
    await ctx.editMessageText(`✅ Удалено вишлистов: ${deleted}`);
    return;
  }
}

// ─── Goal Sets ──────────────────────────────────────────────────────────

async function handleGoalSets(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_goal:menu") {
    await showModeMenu(ctx, "🎯 Цели", "adm_goal");
    return;
  }

  const listMatch = data.match(/^adm_goal:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllGoalSets();
    const items = await getAllGoalSetsPaginated(PAGE_SIZE, offset);
    const lines = items.map((g, i) => {
      const num = offset + i + 1;
      const date = g.createdAt.toLocaleDateString("ru-RU");
      return `*${num}.* ${g.name} (${g.completedCount}/${g.totalCount}) · ${g.firstName} · ${date}`;
    });
    await showPaginatedList(ctx, "🎯 Цели", lines, total, offset, "adm_goal", items.map((g) => g.id));
    return;
  }

  const delMatch = data.match(/^adm_goal:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "набор целей", id, "adm_goal");
    return;
  }

  const delYesMatch = data.match(/^adm_goal:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteGoalSets([id]);
    await ctx.editMessageText(`✅ Набор целей #${id} удалён.`);
    return;
  }

  if (data === "adm_goal:bulk") {
    const items = await getAllGoalSetsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "goal_sets",
      items.map((g) => ({
        id: g.id,
        label: `${g.name} (${g.firstName})`,
      })),
      bulkDeleteGoalSets
    );
    return;
  }

  if (data === "adm_goal:delall") {
    const count = await countAllGoalSets();
    await showDeleteAllConfirm(ctx, "наборы целей", count, "adm_goal");
    return;
  }

  if (data === "adm_goal:delall_yes") {
    const deleted = await deleteAllGoalSets();
    await ctx.editMessageText(`✅ Удалено наборов целей: ${deleted}`);
    return;
  }
}

// ─── Reminders (Admin) ──────────────────────────────────────────────────

async function handleRemindersAdmin(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_rem:menu") {
    await showModeMenu(ctx, "⏰ Напоминания", "adm_rem");
    return;
  }

  const listMatch = data.match(/^adm_rem:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllReminders();
    const items = await getAllRemindersPaginated(PAGE_SIZE, offset);
    const lines = items.map((r, i) => {
      const num = offset + i + 1;
      const timeStr = r.schedule.times?.join(", ") ?? "—";
      const status = r.isActive ? "✅" : "⏸";
      return `*${num}.* ${r.text.slice(0, 40)} · ${timeStr} · ${r.firstName} · ${status}`;
    });
    await showPaginatedList(ctx, "⏰ Напоминания", lines, total, offset, "adm_rem", items.map((r) => r.id));
    return;
  }

  const delMatch = data.match(/^adm_rem:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "напоминание", id, "adm_rem");
    return;
  }

  const delYesMatch = data.match(/^adm_rem:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteReminders([id]);
    await ctx.editMessageText(`✅ Напоминание #${id} удалено.`);
    return;
  }

  if (data === "adm_rem:bulk") {
    const items = await getAllRemindersPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "reminders",
      items.map((r) => ({
        id: r.id,
        label: `${r.text.slice(0, 30)} (${r.firstName})`,
      })),
      bulkDeleteReminders
    );
    return;
  }

  if (data === "adm_rem:delall") {
    const count = await countAllReminders();
    await showDeleteAllConfirm(ctx, "напоминания", count, "adm_rem");
    return;
  }

  if (data === "adm_rem:delall_yes") {
    const deleted = await deleteAllReminders();
    await ctx.editMessageText(`✅ Удалено напоминаний: ${deleted}`);
    return;
  }
}

// ─── OSINT Searches ─────────────────────────────────────────────────────

async function handleOsintSearches(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_osint:menu") {
    await showModeMenu(ctx, "🔍 OSINT", "adm_osint");
    return;
  }

  const listMatch = data.match(/^adm_osint:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllSearches();
    const items = await getAllSearchesPaginated(PAGE_SIZE, offset);
    const lines = items.map((s, i) => {
      const num = offset + i + 1;
      const date = s.createdAt.toLocaleDateString("ru-RU");
      return `*${num}.* ${s.query.slice(0, 40)} · ${s.status} · ${s.firstName} · ${date}`;
    });
    await showPaginatedList(ctx, "🔍 OSINT", lines, total, offset, "adm_osint", items.map((s) => s.id));
    return;
  }

  const delMatch = data.match(/^adm_osint:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "поиск", id, "adm_osint");
    return;
  }

  const delYesMatch = data.match(/^adm_osint:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteSearches([id]);
    await ctx.editMessageText(`✅ Поиск #${id} удалён.`);
    return;
  }

  if (data === "adm_osint:bulk") {
    const items = await getAllSearchesPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "osint_searches",
      items.map((s) => ({
        id: s.id,
        label: `${s.query.slice(0, 30)} (${s.firstName})`,
      })),
      bulkDeleteSearches
    );
    return;
  }

  if (data === "adm_osint:delall") {
    const count = await countAllSearches();
    await showDeleteAllConfirm(ctx, "OSINT-поиски", count, "adm_osint");
    return;
  }

  if (data === "adm_osint:delall_yes") {
    const deleted = await deleteAllSearches();
    await ctx.editMessageText(`✅ Удалено поисков: ${deleted}`);
    return;
  }
}

// ─── Workplaces (Summarizer) ────────────────────────────────────────────

async function handleWorkplaces(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_sum:menu") {
    await showModeMenu(ctx, "📝 Саммаризатор", "adm_sum");
    return;
  }

  const listMatch = data.match(/^adm_sum:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllWorkplaces();
    const items = await getAllWorkplacesPaginated(PAGE_SIZE, offset);
    const lines = items.map((w, i) => {
      const num = offset + i + 1;
      const company = w.company ? ` · ${w.company}` : "";
      return `*${num}.* ${w.title}${company} · ${w.firstName}`;
    });
    await showPaginatedList(ctx, "📝 Саммаризатор", lines, total, offset, "adm_sum", items.map((w) => w.id));
    return;
  }

  const delMatch = data.match(/^adm_sum:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "место работы", id, "adm_sum");
    return;
  }

  const delYesMatch = data.match(/^adm_sum:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteWorkplaces([id]);
    await ctx.editMessageText(`✅ Место работы #${id} удалено.`);
    return;
  }

  if (data === "adm_sum:bulk") {
    const items = await getAllWorkplacesPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "workplaces",
      items.map((w) => ({
        id: w.id,
        label: `${w.title} (${w.firstName})`,
      })),
      bulkDeleteWorkplaces
    );
    return;
  }

  if (data === "adm_sum:delall") {
    const count = await countAllWorkplaces();
    await showDeleteAllConfirm(ctx, "места работы", count, "adm_sum");
    return;
  }

  if (data === "adm_sum:delall_yes") {
    const deleted = await deleteAllWorkplaces();
    await ctx.editMessageText(`✅ Удалено мест работы: ${deleted}`);
    return;
  }
}

// ─── Blog Channels (Blogger) ────────────────────────────────────────────

async function handleBlogChannels(ctx: Context, data: string, telegramId: number): Promise<void> {
  if (data === "adm_blog:menu") {
    await showModeMenu(ctx, "✍️ Блогер", "adm_blog");
    return;
  }

  const listMatch = data.match(/^adm_blog:list:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    const total = await countAllChannels();
    const items = await getAllChannelsPaginated(PAGE_SIZE, offset);
    const lines = items.map((c, i) => {
      const num = offset + i + 1;
      const date = c.createdAt.toLocaleDateString("ru-RU");
      return `*${num}.* ${c.channelTitle} (${c.postCount} постов) · ${c.firstName} · ${date}`;
    });
    await showPaginatedList(ctx, "✍️ Блогер", lines, total, offset, "adm_blog", items.map((c) => c.id));
    return;
  }

  const delMatch = data.match(/^adm_blog:del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await showDeleteConfirm(ctx, "канал", id, "adm_blog");
    return;
  }

  const delYesMatch = data.match(/^adm_blog:del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    await bulkDeleteChannels([id]);
    await ctx.editMessageText(`✅ Канал #${id} удалён.`);
    return;
  }

  if (data === "adm_blog:bulk") {
    const items = await getAllChannelsPaginated(100, 0);
    await initBulkSelect(
      ctx, telegramId, "blogger_channels",
      items.map((c) => ({
        id: c.id,
        label: `${c.channelTitle} (${c.firstName})`,
      })),
      bulkDeleteChannels
    );
    return;
  }

  if (data === "adm_blog:delall") {
    const count = await countAllChannels();
    await showDeleteAllConfirm(ctx, "каналы блогера", count, "adm_blog");
    return;
  }

  if (data === "adm_blog:delall_yes") {
    const deleted = await deleteAllChannels();
    await ctx.editMessageText(`✅ Удалено каналов: ${deleted}`);
    return;
  }
}

// ─── Shared UI helpers ─────────────────────────────────────────────────

/** Show a mode menu with standard options. */
async function showModeMenu(
  ctx: Context,
  title: string,
  prefix: string,
  hasEdit: boolean = false
): Promise<void> {
  const rows = [
    [Markup.button.callback("📋 Список", `${prefix}:list:0`)],
    [Markup.button.callback("🗑 Массовое удаление", `${prefix}:bulk`)],
    [Markup.button.callback("⚠️ Удалить всё", `${prefix}:delall`)],
    [Markup.button.callback("◀️ Назад", "admin:data")],
  ];

  await ctx.editMessageText(`${title}\n\nВыберите действие:`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(rows),
  });
}

/** Show a paginated list with delete/edit buttons per item. */
async function showPaginatedList(
  ctx: Context,
  title: string,
  lines: string[],
  total: number,
  offset: number,
  prefix: string,
  ids: number[]
): Promise<void> {
  if (total === 0) {
    await ctx.editMessageText(`${title}: пусто.`, {
      ...Markup.inlineKeyboard([[Markup.button.callback("◀️ Назад", `${prefix}:menu`)]]),
    });
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const text = `${title} (${currentPage}/${totalPages}, всего: ${total}):\n\n${lines.join("\n\n")}`;

  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Per-item action buttons
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const num = offset + i + 1;
    const row: Array<ReturnType<typeof Markup.button.callback>> = [
      Markup.button.callback(`🗑 #${num}`, `${prefix}:del:${id}`),
    ];
    // Add edit button for modes that support it
    if (prefix === "adm_exp" || prefix === "adm_note" || prefix === "adm_gand" || prefix === "adm_dig") {
      row.push(Markup.button.callback(`✏️ #${num}`, `${prefix}:edit:${id}`));
    }
    rows.push(row);
  }

  // Pagination
  const paginationRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    paginationRow.push(Markup.button.callback("⬅️ Назад", `${prefix}:list:${offset - PAGE_SIZE}`));
  }
  if (offset + PAGE_SIZE < total) {
    paginationRow.push(Markup.button.callback("Вперёд ➡️", `${prefix}:list:${offset + PAGE_SIZE}`));
  }
  if (paginationRow.length > 0) {
    rows.push(paginationRow);
  }

  rows.push([Markup.button.callback("◀️ Меню", `${prefix}:menu`)]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(rows),
  });
}

/** Show single-item delete confirmation. */
async function showDeleteConfirm(
  ctx: Context,
  entityName: string,
  id: number,
  prefix: string
): Promise<void> {
  await ctx.editMessageText(
    `⚠️ Удалить ${entityName} #${id}?\n\nЭто действие необратимо.`,
    {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Да, удалить", `${prefix}:del_yes:${id}`)],
        [Markup.button.callback("❌ Отмена", `${prefix}:menu`)],
      ]),
    }
  );
}

/** Show delete-all confirmation with count. */
async function showDeleteAllConfirm(
  ctx: Context,
  entityName: string,
  count: number,
  prefix: string
): Promise<void> {
  if (count === 0) {
    await ctx.editMessageText(`${entityName}: нечего удалять.`, {
      ...Markup.inlineKeyboard([[Markup.button.callback("◀️ Назад", `${prefix}:menu`)]]),
    });
    return;
  }

  await ctx.editMessageText(
    `⚠️ *Удалить все ${entityName}?*\n\nКоличество: *${count}*\n\nЭто действие необратимо!`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить все (${count})`, `${prefix}:delall_yes`)],
        [Markup.button.callback("❌ Отмена", `${prefix}:menu`)],
      ]),
    }
  );
}
