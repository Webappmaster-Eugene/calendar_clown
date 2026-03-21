/**
 * База знаний (formerly Gandalf) mode command handler.
 * Structured information tracker with categories, entries, files.
 * Supports both tribe-scoped and personal (no tribe) use.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  createCategory,
  getCategoriesByScope,
  getCategoryById,
  deleteCategory,
  createEntry,
  getEntriesByCategory,
  getEntriesByScope,
  getEntryByIdScoped,
  deleteEntry,
  updateEntry,
  countEntriesByCategory,
  countEntriesByScope,
  addFileToEntry,
  getFilesByEntry,
  getStatsByCategory,
  getStatsByYear,
  getStatsByUser,
  getLatestEntryByUser,
  getEntriesByFlag,
  countEntriesByFlag,
  toggleEntryFlag,
  toggleEntryVisibility,
  moveEntryToCategory,
} from "../gandalf/repository.js";
import type { GandalfEntry, GandalfScope } from "../gandalf/repository.js";
import { extractGandalfIntent } from "../voice/extractGandalfIntent.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";
import { escapeMarkdown } from "../utils/markdown.js";

const log = createLogger("gandalf-mode");

const ENTRIES_PAGE_SIZE = 5;

// ─── State ──────────────────────────────────────────────────────────────

interface EntryCreationState {
  step: "title" | "price" | "visibility" | "optional";
  categoryId: number;
  title?: string;
  price?: number | null;
  entryId?: number;
  hasTribe: boolean;
}

const creationStates = new Map<number, EntryCreationState>();
const categoryCreationWaiting = new Set<number>();

// Track which entry user wants to add optional fields to
const optionalFieldStates = new Map<number, { entryId: number; field: "next_date" | "additional_info" }>();

// Track which entry field user is editing
const editFieldStates = new Map<number, { entryId: number; field: "title" | "price" | "date" | "info" }>();

/** Build scope object for the user. */
function buildScope(dbUser: { id: number; tribeId: number | null }): GandalfScope {
  if (dbUser.tribeId) {
    return { type: "tribe", tribeId: dbUser.tribeId, userId: dbUser.id };
  }
  return { type: "personal", userId: dbUser.id };
}

function getScopeTribeId(scope: GandalfScope): number | null {
  return scope.type === "tribe" ? scope.tribeId : null;
}

function getGandalfKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📦 Категории", "➕ Новая запись"],
    ["⭐ Важное", "🔥 Срочное"],
    ["📊 Статистика", "📋 Все записи"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleGandalfCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("📚 База знаний недоступна (нет подключения к базе данных).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "gandalf");
  await setModeMenuCommands(ctx, "gandalf");

  const isAdmin = isBootstrapAdmin(telegramId);
  const scopeLabel = dbUser.tribeId
    ? "Записи видны всем участникам семьи (можно делать приватными)."
    : "Ваша личная база знаний.";

  await ctx.reply(
    "📚 *База знаний активирована*\n\n" +
    "Создавайте категории, добавляйте записи текстом или голосом.\n" +
    "Прикрепляйте фото и документы.\n" +
    "Отмечайте важное ⭐ и срочное 🔥\n\n" +
    scopeLabel,
    { parse_mode: "Markdown", ...getGandalfKeyboard(isAdmin) }
  );
}

// ─── Categories ─────────────────────────────────────────────────────────

export async function handleGandalfCategoriesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const scope = buildScope(dbUser);
  const categories = await getCategoriesByScope(scope);

  if (categories.length === 0) {
    await ctx.reply(
      "📦 Категорий пока нет.\n\nСоздайте первую — нажмите кнопку ниже.",
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("➕ Создать категорию", "gandalf_new_cat")],
        ]),
      }
    );
    return;
  }

  const buttons = categories.map((c) => [
    Markup.button.callback(`${c.emoji} ${c.name}`, `gandalf_view_cat:${c.id}`),
    Markup.button.callback("🗑", `gandalf_del_cat:${c.id}`),
  ]);
  buttons.push([Markup.button.callback("➕ Создать категорию", "gandalf_new_cat")]);

  await ctx.reply(`📦 *Категории (${categories.length}):*`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleGandalfNewCatCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  categoryCreationWaiting.add(telegramId);
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Отправьте название новой категории.\nМожно добавить эмодзи в начале, например: «🏠 ЖКХ»"
  );
}

export async function handleGandalfViewCatCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_view_cat:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const categoryId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const tribeId = dbUser.tribeId;
  const count = await countEntriesByCategory(tribeId, categoryId);
  const entries = await getEntriesByCategory(tribeId, categoryId, ENTRIES_PAGE_SIZE, 0);

  await ctx.answerCbQuery();

  if (entries.length === 0) {
    await ctx.editMessageText("В этой категории пока нет записей.");
    return;
  }

  const totalPages = Math.ceil(count / ENTRIES_PAGE_SIZE);
  const text = `📋 *Записи (1/${totalPages}, всего: ${count}):*\n\n` + formatEntriesList(entries);
  const buttons = buildEntryButtons(entries);

  if (count > ENTRIES_PAGE_SIZE) {
    buttons.reply_markup.inline_keyboard.push([
      Markup.button.callback("Вперёд ➡️", `gandalf_page:${categoryId}:${ENTRIES_PAGE_SIZE}`),
    ]);
  }

  await ctx.editMessageText(text, { parse_mode: "Markdown", ...buttons });
}

export async function handleGandalfDelCatCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_del_cat:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const categoryId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  await deleteCategory(categoryId, dbUser.tribeId);
  logAction(dbUser.id, telegramId, "gandalf_category_delete", { categoryId });
  await ctx.answerCbQuery("Категория удалена");
  await ctx.editMessageText("✅ Категория деактивирована.");
}

// ─── New Entry ──────────────────────────────────────────────────────────

export async function handleGandalfNewEntryButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const scope = buildScope(dbUser);
  const categories = await getCategoriesByScope(scope);

  if (categories.length === 0) {
    await ctx.reply(
      "Сначала создайте категорию. Нажмите «📦 Категории»."
    );
    return;
  }

  const buttons = categories.map((c) => [
    Markup.button.callback(`${c.emoji} ${c.name}`, `gandalf_entry_cat:${c.id}`),
  ]);

  await ctx.reply("Выберите категорию для новой записи:", {
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleGandalfEntryCatCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_entry_cat:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const categoryId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  const hasTribe = dbUser?.tribeId != null;
  creationStates.set(telegramId, { step: "title", categoryId, hasTribe });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Введите название записи:");
}

// ─── All Entries ────────────────────────────────────────────────────────

export async function handleGandalfAllEntriesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const scope = buildScope(dbUser);
  const total = await countEntriesByScope(scope);
  if (total === 0) {
    await ctx.reply("Записей пока нет. Нажмите «➕ Новая запись» чтобы создать первую.");
    return;
  }

  const entries = await getEntriesByScope(scope, ENTRIES_PAGE_SIZE, 0);
  const totalPages = Math.ceil(total / ENTRIES_PAGE_SIZE);
  const buttons = buildEntryButtons(entries);

  if (total > ENTRIES_PAGE_SIZE) {
    buttons.reply_markup.inline_keyboard.push([
      Markup.button.callback("Вперёд ➡️", `gandalf_page:0:${ENTRIES_PAGE_SIZE}`),
    ]);
  }

  await ctx.reply(
    `📋 *Все записи (1/${totalPages}, всего: ${total}):*\n\n` + formatEntriesList(entries),
    { parse_mode: "Markdown", ...buttons }
  );
}

// ─── Important / Urgent Buttons ─────────────────────────────────────────

export async function handleGandalfImportantButton(ctx: Context): Promise<void> {
  await showFlaggedEntries(ctx, "important");
}

export async function handleGandalfUrgentButton(ctx: Context): Promise<void> {
  await showFlaggedEntries(ctx, "urgent");
}

async function showFlaggedEntries(ctx: Context, flag: "important" | "urgent"): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const scope = buildScope(dbUser);
  const total = await countEntriesByFlag(scope, flag);
  const label = flag === "important" ? "⭐ Важное" : "🔥 Срочное";

  if (total === 0) {
    await ctx.reply(`${label}: пока нет записей с этой отметкой.`);
    return;
  }

  const entries = await getEntriesByFlag(scope, flag, ENTRIES_PAGE_SIZE, 0);
  const totalPages = Math.ceil(total / ENTRIES_PAGE_SIZE);
  const buttons = buildEntryButtons(entries);

  await ctx.reply(
    `${label} *(1/${totalPages}, всего: ${total}):*\n\n` + formatEntriesList(entries),
    { parse_mode: "Markdown", ...buttons }
  );
}

// ─── Pagination ─────────────────────────────────────────────────────────

export async function handleGandalfPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_page:(\d+):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const categoryId = parseInt(match[1], 10);
  const offset = parseInt(match[2], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);
  const isAllEntries = categoryId === 0;
  const total = isAllEntries
    ? await countEntriesByScope(scope)
    : await countEntriesByCategory(dbUser.tribeId, categoryId);
  const entries = isAllEntries
    ? await getEntriesByScope(scope, ENTRIES_PAGE_SIZE, offset)
    : await getEntriesByCategory(dbUser.tribeId, categoryId, ENTRIES_PAGE_SIZE, offset);

  const totalPages = Math.ceil(total / ENTRIES_PAGE_SIZE);
  const currentPage = Math.floor(offset / ENTRIES_PAGE_SIZE) + 1;
  const buttons = buildEntryButtons(entries);

  const navButtons: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    navButtons.push(Markup.button.callback("⬅️ Назад", `gandalf_page:${categoryId}:${offset - ENTRIES_PAGE_SIZE}`));
  }
  if (offset + ENTRIES_PAGE_SIZE < total) {
    navButtons.push(Markup.button.callback("Вперёд ➡️", `gandalf_page:${categoryId}:${offset + ENTRIES_PAGE_SIZE}`));
  }
  if (navButtons.length > 0) {
    buttons.reply_markup.inline_keyboard.push(navButtons);
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📋 *Записи (${currentPage}/${totalPages}, всего: ${total}):*\n\n` + formatEntriesList(entries),
    { parse_mode: "Markdown", ...buttons }
  );
}

// ─── Entry Actions ──────────────────────────────────────────────────────

export async function handleGandalfEntryActionCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);

  // View entry detail
  const viewMatch = data.match(/^gandalf_view:(\d+)$/);
  if (viewMatch) {
    const entryId = parseInt(viewMatch[1], 10);
    const entry = await getEntryByIdScoped(entryId, scope);
    if (!entry) {
      await ctx.answerCbQuery("Запись не найдена");
      return;
    }
    const files = await getFilesByEntry(entryId);
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatSingleEntry(entry, files.length), {
      parse_mode: "Markdown",
      ...buildSingleEntryButtons(entry, files.length, scope),
    });
    return;
  }

  // Delete entry
  const delMatch = data.match(/^gandalf_del:(\d+)$/);
  if (delMatch) {
    const entryId = parseInt(delMatch[1], 10);
    await deleteEntry(entryId, getScopeTribeId(scope));
    logAction(dbUser.id, telegramId, "gandalf_entry_delete", { entryId });
    await ctx.answerCbQuery("Запись удалена");
    await ctx.editMessageText("✅ Запись удалена.");
    return;
  }

  await ctx.answerCbQuery();
}

// ─── Flag Toggle Callbacks ──────────────────────────────────────────────

export async function handleGandalfFlagCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  const impMatch = data.match(/^gandalf_imp:(\d+)$/);
  const urgMatch = data.match(/^gandalf_urg:(\d+)$/);
  const match = impMatch ?? urgMatch;
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const flag = impMatch ? "important" : "urgent";

  await toggleEntryFlag(entryId, tribeId, flag);
  const emoji = flag === "important" ? "⭐" : "🔥";
  await ctx.answerCbQuery(`${emoji} Переключено`);

  // Re-render entry
  const entry = await getEntryByIdScoped(entryId, scope);
  if (entry) {
    const files = await getFilesByEntry(entryId);
    try {
      await ctx.editMessageText(formatSingleEntry(entry, files.length), {
        parse_mode: "Markdown",
        ...buildSingleEntryButtons(entry, files.length, scope),
      });
    } catch {
      // Message not modified — ignore
    }
  }
}

// ─── Visibility Toggle Callback ─────────────────────────────────────────

export async function handleGandalfVisibilityCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_vis_toggle:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);
  const newVis = await toggleEntryVisibility(entryId, tribeId);
  const label = newVis === "private" ? "🔒 Приватная" : "🌐 Для трайба";
  await ctx.answerCbQuery(label);

  // Re-render
  const entry = await getEntryByIdScoped(entryId, scope);
  if (entry) {
    const files = await getFilesByEntry(entryId);
    try {
      await ctx.editMessageText(formatSingleEntry(entry, files.length), {
        parse_mode: "Markdown",
        ...buildSingleEntryButtons(entry, files.length, scope),
      });
    } catch {
      // Message not modified — ignore
    }
  }
}

// ─── Visibility Selection (during creation) ─────────────────────────────

export async function handleGandalfVisibilitySelectCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_vis:(tribe|private)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const visibility = match[1] as "tribe" | "private";
  const state = creationStates.get(telegramId);
  if (!state || state.step !== "visibility") {
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();
  creationStates.delete(telegramId);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  try {
    const entry = await createEntry({
      tribeId,
      categoryId: state.categoryId,
      title: state.title!,
      price: state.price,
      addedByUserId: dbUser.id,
      inputMethod: "text",
      visibility,
    });
    logAction(dbUser.id, telegramId, "gandalf_entry_create", {
      entryId: entry.id,
      inputMethod: "text",
    });

    const cat = entry.categoryName
      ? `${entry.categoryEmoji ?? "📁"} ${entry.categoryName}`
      : "";
    const priceStr = state.price != null ? `\n💰 ${formatPrice(state.price)}` : "";
    const visLabel = visibility === "private" ? "🔒 Приватная" : "🌐 Для трайба";

    await ctx.editMessageText(
      `✅ Запись сохранена ${visLabel}\n📦 ${cat}\n📝 ${entry.title}${priceStr}`,
    );
    await ctx.reply("Дополнительные опции:", {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("📅 Добавить дату", `gandalf_opt_date:${entry.id}`),
          Markup.button.callback("ℹ️ Доп. инфо", `gandalf_opt_info:${entry.id}`),
        ],
        [Markup.button.callback("✅ Готово", `gandalf_opt_done:${entry.id}`)],
      ]),
    });
  } catch (err) {
    log.error("Error creating gandalf entry:", err);
    await ctx.editMessageText("Ошибка при создании записи.");
  }
}

// ─── Move Entry ─────────────────────────────────────────────────────────

export async function handleGandalfMoveCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_move:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);
  const categories = await getCategoriesByScope(scope);

  if (categories.length <= 1) {
    await ctx.answerCbQuery("Нужно больше одной категории");
    return;
  }

  const buttons = categories.map((c) => [
    Markup.button.callback(`${c.emoji} ${c.name}`, `gandalf_move_to:${entryId}:${c.id}`),
  ]);

  await ctx.answerCbQuery();
  await ctx.editMessageText("📂 Выберите категорию для перемещения:", {
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleGandalfMoveToCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_move_to:(\d+):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const newCategoryId = parseInt(match[2], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  const moved = await moveEntryToCategory(entryId, tribeId, newCategoryId);
  if (moved) {
    await ctx.answerCbQuery("✅ Перемещено");
    await ctx.editMessageText("✅ Запись перемещена в другую категорию.");
  } else {
    await ctx.answerCbQuery("Ошибка перемещения");
  }
}

// ─── Entry Edit ─────────────────────────────────────────────────────────

/** Helper to re-render entry detail after edit. */
async function reRenderEntry(ctx: Context, entryId: number, scope: GandalfScope): Promise<void> {
  const entry = await getEntryByIdScoped(entryId, scope);
  if (!entry) return;
  const files = await getFilesByEntry(entryId);
  try {
    await ctx.reply(formatSingleEntry(entry, files.length), {
      parse_mode: "Markdown",
      ...buildSingleEntryButtons(entry, files.length, scope),
    });
  } catch { /* ignore */ }
}

export async function handleGandalfEditCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const data = ctx.callbackQuery.data;

  const titleMatch = data.match(/^gandalf_edit_title:(\d+)$/);
  if (titleMatch) {
    editFieldStates.set(telegramId, { entryId: parseInt(titleMatch[1], 10), field: "title" });
    await ctx.answerCbQuery();
    await ctx.editMessageText("✏️ Введите новое название:");
    return;
  }

  const priceMatch = data.match(/^gandalf_edit_price:(\d+)$/);
  if (priceMatch) {
    editFieldStates.set(telegramId, { entryId: parseInt(priceMatch[1], 10), field: "price" });
    await ctx.answerCbQuery();
    await ctx.editMessageText("💰 Введите новую цену (или «-» чтобы убрать):");
    return;
  }

  const dateMatch = data.match(/^gandalf_edit_date:(\d+)$/);
  if (dateMatch) {
    editFieldStates.set(telegramId, { entryId: parseInt(dateMatch[1], 10), field: "date" });
    await ctx.answerCbQuery();
    await ctx.editMessageText("📅 Введите новую дату (например: 2026-06-15 или «-» чтобы убрать):");
    return;
  }

  const infoMatch = data.match(/^gandalf_edit_info:(\d+)$/);
  if (infoMatch) {
    editFieldStates.set(telegramId, { entryId: parseInt(infoMatch[1], 10), field: "info" });
    await ctx.answerCbQuery();
    await ctx.editMessageText("ℹ️ Введите новую дополнительную информацию (или «-» чтобы убрать):");
    return;
  }

  await ctx.answerCbQuery();
}

export async function handleGandalfClearMenuCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_clear_menu:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  await ctx.answerCbQuery();
  await ctx.editMessageText("🧹 Какое поле очистить?", {
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("💰 Цена", `gandalf_clear:${entryId}:price`),
        Markup.button.callback("📅 Дата", `gandalf_clear:${entryId}:date`),
      ],
      [
        Markup.button.callback("ℹ️ Доп. инфо", `gandalf_clear:${entryId}:info`),
      ],
      [Markup.button.callback("◀️ Назад", `gandalf_view:${entryId}`)],
    ]),
  });
}

export async function handleGandalfClearFieldCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_clear:(\d+):(price|date|info)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const field = match[2];

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) { await ctx.answerCbQuery(); return; }

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  const fieldLabels: Record<string, string> = { price: "Цена", date: "Дата", info: "Доп. инфо" };
  const updates: { price?: null; nextDate?: null; additionalInfo?: null } = {};
  if (field === "price") updates.price = null;
  if (field === "date") updates.nextDate = null;
  if (field === "info") updates.additionalInfo = null;

  try {
    await updateEntry(entryId, tribeId, updates);
    await ctx.answerCbQuery(`🧹 ${fieldLabels[field]} очищено`);
    await reRenderEntry(ctx, entryId, scope);
  } catch (err) {
    log.error("Error clearing gandalf entry field:", err);
    await ctx.answerCbQuery("Ошибка при очистке поля");
  }
}

// ─── Entry Files ────────────────────────────────────────────────────────

export async function handleGandalfFilesCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_files:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const files = await getFilesByEntry(entryId);
  await ctx.answerCbQuery();

  if (files.length === 0) {
    await ctx.reply("К этой записи нет прикреплённых файлов.");
    return;
  }

  for (const file of files) {
    try {
      if (file.fileType === "photo") {
        await ctx.replyWithPhoto(file.telegramFileId, {
          caption: file.fileName ?? undefined,
        });
      } else {
        await ctx.replyWithDocument(file.telegramFileId, {
          caption: file.fileName ?? undefined,
        });
      }
    } catch (err) {
      log.error(`Failed to send file ${file.id}:`, err);
      await ctx.reply(`Не удалось отправить файл: ${file.fileName ?? file.telegramFileId}`);
    }
  }
}

// ─── Optional Fields ────────────────────────────────────────────────────

export async function handleGandalfOptionalCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const data = ctx.callbackQuery.data;

  const dateMatch = data.match(/^gandalf_opt_date:(\d+)$/);
  if (dateMatch) {
    const entryId = parseInt(dateMatch[1], 10);
    optionalFieldStates.set(telegramId, { entryId, field: "next_date" });
    await ctx.answerCbQuery();
    await ctx.editMessageText("Введите дату (например: 2026-06-15 или «через месяц»):");
    return;
  }

  const infoMatch = data.match(/^gandalf_opt_info:(\d+)$/);
  if (infoMatch) {
    const entryId = parseInt(infoMatch[1], 10);
    optionalFieldStates.set(telegramId, { entryId, field: "additional_info" });
    await ctx.answerCbQuery();
    await ctx.editMessageText("Введите дополнительную информацию:");
    return;
  }

  const doneMatch = data.match(/^gandalf_opt_done:(\d+)$/);
  if (doneMatch) {
    await ctx.answerCbQuery("✅ Готово");
    await ctx.editMessageText("✅ Запись сохранена.");
    return;
  }

  await ctx.answerCbQuery();
}

// ─── Stats ──────────────────────────────────────────────────────────────

export async function handleGandalfStatsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const buttons = [
    [Markup.button.callback("📦 По категориям", "gandalf_stats:categories")],
    [Markup.button.callback("📅 По годам", "gandalf_stats:years")],
  ];
  // User stats only for tribes
  if (dbUser.tribeId) {
    buttons.push([Markup.button.callback("👥 По участникам", "gandalf_stats:users")]);
  }

  await ctx.reply("Выберите вид статистики:", {
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleGandalfStatsCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_stats:(\w+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const statsType = match[1];
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery();
    return;
  }

  // Stats require tribeId for now (personal stats not yet implemented)
  if (!dbUser.tribeId) {
    await ctx.answerCbQuery("Статистика пока доступна только в трайбе");
    return;
  }

  await ctx.answerCbQuery();

  if (statsType === "categories") {
    const stats = await getStatsByCategory(dbUser.tribeId);
    if (stats.length === 0) {
      await ctx.editMessageText("Нет данных для статистики.");
      return;
    }
    const lines = stats.map((s) => {
      const priceStr = s.totalPrice != null ? ` | 💰 ${formatPrice(s.totalPrice)}` : "";
      return `${s.categoryEmoji} *${escapeMarkdown(s.categoryName)}*: ${s.totalEntries} зап.${priceStr}`;
    });
    await ctx.editMessageText(`📦 *Статистика по категориям:*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (statsType === "years") {
    const stats = await getStatsByYear(dbUser.tribeId);
    if (stats.length === 0) {
      await ctx.editMessageText("Нет данных для статистики.");
      return;
    }
    const lines = stats.map((s) => {
      const priceStr = s.totalPrice != null ? ` | 💰 ${formatPrice(s.totalPrice)}` : "";
      return `📅 *${s.year}*: ${s.totalEntries} зап.${priceStr}`;
    });
    await ctx.editMessageText(`📅 *Статистика по годам:*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (statsType === "users") {
    const stats = await getStatsByUser(dbUser.tribeId);
    if (stats.length === 0) {
      await ctx.editMessageText("Нет данных для статистики.");
      return;
    }
    const lines = stats.map((s) => {
      const priceStr = s.totalPrice != null ? ` | 💰 ${formatPrice(s.totalPrice)}` : "";
      return `👤 *${escapeMarkdown(s.firstName)}*: ${s.totalEntries} зап.${priceStr}`;
    });
    await ctx.editMessageText(`👥 *Статистика по участникам:*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  await ctx.editMessageText("Неизвестный тип статистики.");
}

// ─── Text Handler ───────────────────────────────────────────────────────

/**
 * Handle text input in gandalf mode.
 * Returns true if the message was consumed.
 */
export async function handleGandalfText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const text = ctx.message.text.trim();
  if (!text) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return false;

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  // Category creation flow
  if (categoryCreationWaiting.has(telegramId)) {
    categoryCreationWaiting.delete(telegramId);
    try {
      const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
      let name = text;
      let emoji = "📁";
      if (emojiMatch) {
        emoji = emojiMatch[1];
        name = text.slice(emojiMatch[0].length).trim();
      }
      if (!name) name = text;

      const category = await createCategory(tribeId, name, emoji, dbUser.id);
      logAction(dbUser.id, telegramId, "gandalf_category_create", { categoryId: category.id, name });
      await ctx.reply(`${category.emoji} Категория «${category.name}» создана!`);
    } catch (err) {
      log.error("Error creating gandalf category:", err);
      await ctx.reply("Ошибка при создании категории. Возможно, такая уже существует.");
    }
    return true;
  }

  // Edit field input
  const editState = editFieldStates.get(telegramId);
  if (editState) {
    editFieldStates.delete(telegramId);
    try {
      if (editState.field === "title") {
        await updateEntry(editState.entryId, tribeId, { title: text });
        await ctx.reply(`✏️ Название обновлено: ${text}`);
      } else if (editState.field === "price") {
        if (text === "-") {
          await updateEntry(editState.entryId, tribeId, { price: null });
          await ctx.reply("💰 Цена убрана.");
        } else {
          const parsed = parseFloat(text.replace(/\s/g, "").replace(",", "."));
          if (isNaN(parsed) || parsed < 0) {
            await ctx.reply("Некорректная цена. Изменение отменено.");
            return true;
          }
          await updateEntry(editState.entryId, tribeId, { price: parsed });
          await ctx.reply(`💰 Цена обновлена: ${formatPrice(parsed)}`);
        }
      } else if (editState.field === "date") {
        if (text === "-") {
          await updateEntry(editState.entryId, tribeId, { nextDate: null });
          await ctx.reply("📅 Дата убрана.");
        } else {
          const parsed = new Date(text);
          if (isNaN(parsed.getTime())) {
            await ctx.reply("Не удалось разобрать дату. Изменение отменено.");
            return true;
          }
          await updateEntry(editState.entryId, tribeId, { nextDate: parsed });
          await ctx.reply(`📅 Дата обновлена: ${parsed.toLocaleDateString("ru-RU")}`);
        }
      } else if (editState.field === "info") {
        if (text === "-") {
          await updateEntry(editState.entryId, tribeId, { additionalInfo: null });
          await ctx.reply("ℹ️ Дополнительная информация убрана.");
        } else {
          await updateEntry(editState.entryId, tribeId, { additionalInfo: text });
          await ctx.reply("ℹ️ Дополнительная информация обновлена.");
        }
      }
      // Show updated entry
      await reRenderEntry(ctx, editState.entryId, scope);
    } catch (err) {
      log.error("Error updating gandalf entry field:", err);
      await ctx.reply("Ошибка при обновлении записи.");
    }
    return true;
  }

  // Optional field input
  const optState = optionalFieldStates.get(telegramId);
  if (optState) {
    optionalFieldStates.delete(telegramId);
    try {
      if (optState.field === "next_date") {
        const parsed = new Date(text);
        if (isNaN(parsed.getTime())) {
          await ctx.reply("Не удалось разобрать дату. Запись сохранена без даты.");
          return true;
        }
        await updateEntry(optState.entryId, tribeId, { nextDate: parsed });
        await ctx.reply(`📅 Дата установлена: ${parsed.toLocaleDateString("ru-RU")}`);
      } else {
        await updateEntry(optState.entryId, tribeId, { additionalInfo: text });
        await ctx.reply("ℹ️ Дополнительная информация сохранена.");
      }
    } catch (err) {
      log.error("Error updating gandalf entry optional field:", err);
      await ctx.reply("Ошибка при обновлении записи.");
    }
    return true;
  }

  // Entry creation flow
  const state = creationStates.get(telegramId);
  if (!state) return false;

  if (state.step === "title") {
    state.title = text;
    state.step = "price";
    creationStates.set(telegramId, state);
    await ctx.reply("Введите цену (или отправьте «-» чтобы пропустить):");
    return true;
  }

  if (state.step === "price") {
    let price: number | null = null;
    if (text !== "-") {
      const parsed = parseFloat(text.replace(/\s/g, "").replace(",", "."));
      if (!isNaN(parsed) && parsed >= 0) {
        price = parsed;
      } else {
        await ctx.reply("Некорректная цена. Запись создана без цены.");
      }
    }
    state.price = price;

    // If user has tribe — ask for visibility
    if (state.hasTribe) {
      state.step = "visibility";
      creationStates.set(telegramId, state);
      await ctx.reply("Выберите видимость записи:", {
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("🌐 Для трайба", "gandalf_vis:tribe"),
            Markup.button.callback("🔒 Приватная", "gandalf_vis:private"),
          ],
        ]),
      });
      return true;
    }

    // No tribe — create immediately as private
    creationStates.delete(telegramId);

    try {
      const entry = await createEntry({
        tribeId: null,
        categoryId: state.categoryId,
        title: state.title!,
        price,
        addedByUserId: dbUser.id,
        inputMethod: "text",
        visibility: "private",
      });
      logAction(dbUser.id, telegramId, "gandalf_entry_create", {
        entryId: entry.id,
        inputMethod: "text",
      });

      const cat = entry.categoryName
        ? `${entry.categoryEmoji ?? "📁"} ${entry.categoryName}`
        : "";
      const priceStr = price != null ? `\n💰 ${formatPrice(price)}` : "";

      await ctx.reply(
        `✅ Запись сохранена\n📦 ${cat}\n📝 ${entry.title}${priceStr}`,
        {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("📅 Добавить дату", `gandalf_opt_date:${entry.id}`),
              Markup.button.callback("ℹ️ Доп. инфо", `gandalf_opt_info:${entry.id}`),
            ],
            [Markup.button.callback("✅ Готово", `gandalf_opt_done:${entry.id}`)],
          ]),
        }
      );
    } catch (err) {
      log.error("Error creating gandalf entry:", err);
      await ctx.reply("Ошибка при создании записи.");
    }
    return true;
  }

  return false;
}

// ─── Voice Handler ──────────────────────────────────────────────────────

export async function handleGandalfVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  try {
    const categories = await getCategoriesByScope(scope);
    if (categories.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        "Сначала создайте хотя бы одну категорию через «📦 Категории»."
      );
      return;
    }

    const categoriesList = categories.map((c) => `- ${c.name}`).join("\n");
    const result = await extractGandalfIntent(transcript, categoriesList);

    if (result.type === "not_gandalf") {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        "Это не похоже на запись для базы знаний. Скажите что записать, например: «Запиши в ЖКХ показания счётчика 123»."
      );
      return;
    }

    if (result.type === "unknown") {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        "Не удалось разобрать запись из голосового сообщения. Назовите категорию и что записать."
      );
      return;
    }

    if (result.type === "partial") {
      if (result.category && result.title) {
        const cat = categories.find(
          (c) => c.name.toLowerCase() === result.category!.toLowerCase()
        );
        if (cat) {
          const visibility = tribeId ? "tribe" : "private";
          const entry = await createEntry({
            tribeId,
            categoryId: cat.id,
            title: result.title,
            price: result.price,
            addedByUserId: dbUser.id,
            inputMethod: "voice",
            visibility,
            isImportant: result.isImportant ?? false,
            isUrgent: result.isUrgent ?? false,
          });
          logAction(dbUser.id, telegramId, "gandalf_entry_create", {
            entryId: entry.id,
            inputMethod: "voice",
          });
          const priceStr = result.price != null ? `\n💰 ${formatPrice(result.price)}` : "";
          await ctx.telegram.editMessageText(
            ctx.chat!.id,
            statusMsgId,
            undefined,
            `✅ Запись из голосового сохранена\n${cat.emoji} ${cat.name}\n📝 ${result.title}${priceStr}`
          );
          return;
        }
      }
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        "Не удалось полностью разобрать запись. Уточните категорию и название."
      );
      return;
    }

    // Full gandalf_entry
    const cat = categories.find(
      (c) => c.name.toLowerCase() === result.category.toLowerCase()
    );
    if (!cat) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        `Категория «${result.category}» не найдена. Доступные: ${categories.map((c) => c.name).join(", ")}`
      );
      return;
    }

    const nextDate = result.nextDate ? new Date(result.nextDate) : null;
    const visibility = tribeId ? "tribe" : "private";
    const entry = await createEntry({
      tribeId,
      categoryId: cat.id,
      title: result.title,
      price: result.price,
      addedByUserId: dbUser.id,
      nextDate: nextDate && !isNaN(nextDate.getTime()) ? nextDate : null,
      additionalInfo: result.additionalInfo,
      inputMethod: "voice",
      visibility,
      isImportant: result.isImportant ?? false,
      isUrgent: result.isUrgent ?? false,
    });
    logAction(dbUser.id, telegramId, "gandalf_entry_create", {
      entryId: entry.id,
      inputMethod: "voice",
    });

    const priceStr = result.price != null ? `\n💰 ${formatPrice(result.price)}` : "";
    const dateStr = nextDate && !isNaN(nextDate.getTime())
      ? `\n📅 Следующая: ${nextDate.toLocaleDateString("ru-RU")}`
      : "";
    const infoStr = result.additionalInfo ? `\nℹ️ ${result.additionalInfo}` : "";
    const flagsStr = (result.isImportant ? " ⭐" : "") + (result.isUrgent ? " 🔥" : "");

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `✅ Запись из голосового сохранена${flagsStr}\n${cat.emoji} ${cat.name}\n📝 ${result.title}${priceStr}${dateStr}${infoStr}`
    );
  } catch (err) {
    log.error("Error processing gandalf voice:", err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Ошибка при обработке голосового сообщения."
    );
  }
}

// ─── File Attachment Handler ────────────────────────────────────────────

export async function handleGandalfFileAttachment(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return false;

  const scope = buildScope(dbUser);
  const tribeId = getScopeTribeId(scope);

  let fileId: string | undefined;
  let fileType: string = "document";
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;

  if (ctx.message && "photo" in ctx.message && ctx.message.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    fileId = photo.file_id;
    fileType = "photo";
    fileSize = photo.file_size ?? null;
    mimeType = "image/jpeg";
  } else if (ctx.message && "document" in ctx.message && ctx.message.document) {
    const doc = ctx.message.document;
    fileId = doc.file_id;
    fileType = "document";
    fileName = doc.file_name ?? null;
    mimeType = doc.mime_type ?? null;
    fileSize = doc.file_size ?? null;
  }

  if (!fileId) return false;

  // Check if in creation flow — attach to entry being created
  const state = creationStates.get(telegramId);
  if (state?.step === "optional" && state.entryId) {
    try {
      await addFileToEntry({
        entryId: state.entryId,
        telegramFileId: fileId,
        fileType,
        fileName,
        mimeType,
        fileSizeBytes: fileSize,
      });
      await ctx.reply("📎 Файл прикреплён к записи.");
    } catch (err) {
      log.error("Error attaching file to gandalf entry:", err);
      await ctx.reply("Ошибка при прикреплении файла.");
    }
    return true;
  }

  // Otherwise, attach to latest entry
  const latestEntry = await getLatestEntryByUser(tribeId, dbUser.id);
  if (!latestEntry) {
    await ctx.reply("Нет записей для прикрепления файла. Сначала создайте запись.");
    return true;
  }

  try {
    await addFileToEntry({
      entryId: latestEntry.id,
      telegramFileId: fileId,
      fileType,
      fileName,
      mimeType,
      fileSizeBytes: fileSize,
    });
    const catLabel = latestEntry.categoryName
      ? `${latestEntry.categoryEmoji ?? "📁"} ${latestEntry.categoryName}`
      : "";
    await ctx.reply(
      `📎 Файл прикреплён к записи:\n${catLabel} — ${latestEntry.title}`
    );
  } catch (err) {
    log.error("Error attaching file to gandalf entry:", err);
    await ctx.reply("Ошибка при прикреплении файла.");
  }
  return true;
}

// ─── Formatting ─────────────────────────────────────────────────────────

function formatEntriesList(entries: GandalfEntry[]): string {
  return entries.map((e, i) => {
    const cat = e.categoryName ? `${e.categoryEmoji ?? "📁"} ${e.categoryName}` : "";
    const priceStr = e.price != null ? ` | 💰 ${formatPrice(e.price)}` : "";
    const flags = (e.isImportant ? "⭐" : "") + (e.isUrgent ? "🔥" : "") + (e.visibility === "private" ? "🔒" : "");
    const flagsStr = flags ? ` ${flags}` : "";
    const date = e.createdAt.toLocaleDateString("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const author = e.addedByName ? ` — ${e.addedByName}` : "";
    return `*${i + 1}.* ${cat}${priceStr}${flagsStr}\n${escapeMarkdown(e.title)}\n_${date}${author}_`;
  }).join("\n\n");
}

function formatSingleEntry(entry: GandalfEntry, filesCount: number): string {
  const cat = entry.categoryName
    ? `📦 ${entry.categoryEmoji ?? "📁"} ${entry.categoryName}`
    : "📦 Без категории";
  const priceStr = entry.price != null ? `\n💰 ${formatPrice(entry.price)}` : "";
  const dateStr = entry.nextDate
    ? `\n📅 Следующая: ${entry.nextDate.toLocaleDateString("ru-RU")}`
    : "";
  const infoStr = entry.additionalInfo
    ? `\nℹ️ ${escapeMarkdown(entry.additionalInfo)}`
    : "";
  const date = entry.createdAt.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const method = entry.inputMethod === "voice" ? "🎤 Голосом" : "⌨️ Текстом";
  const author = entry.addedByName ? `👤 ${escapeMarkdown(entry.addedByName)}` : "";
  const filesStr = filesCount > 0 ? `\n📎 Файлов: ${filesCount}` : "";

  const flagsArr: string[] = [];
  if (entry.isImportant) flagsArr.push("⭐ Важное");
  if (entry.isUrgent) flagsArr.push("🔥 Срочное");
  const visLabel = entry.visibility === "private" ? "🔒 Приватная" : "🌐 Трайб";
  flagsArr.push(visLabel);
  const flagsStr = flagsArr.length > 0 ? `\n${flagsArr.join(" | ")}` : "";

  const parts = [
    `📚 *Запись #${entry.id}*`,
    cat,
    `📝 ${escapeMarkdown(entry.title)}`,
  ];
  if (priceStr) parts.push(priceStr.trim());
  if (dateStr) parts.push(dateStr.trim());
  if (infoStr) parts.push(infoStr.trim());
  parts.push(flagsStr.trim());
  parts.push(`${date} | ${method}`);
  if (author) parts.push(author);
  if (filesStr) parts.push(filesStr.trim());

  return parts.join("\n");
}

function buildEntryButtons(entries: GandalfEntry[]) {
  const buttons = entries.map((e) => [
    Markup.button.callback(`📚 #${e.id}`, `gandalf_view:${e.id}`),
    Markup.button.callback("🗑", `gandalf_del:${e.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

function buildSingleEntryButtons(entry: GandalfEntry, filesCount: number, scope: GandalfScope) {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Flag toggles
  const impLabel = entry.isImportant ? "⭐ Убрать важное" : "⭐ Важное";
  const urgLabel = entry.isUrgent ? "🔥 Убрать срочное" : "🔥 Срочное";
  buttons.push([
    Markup.button.callback(impLabel, `gandalf_imp:${entry.id}`),
    Markup.button.callback(urgLabel, `gandalf_urg:${entry.id}`),
  ]);

  // Visibility toggle (only for tribe users)
  if (scope.type === "tribe") {
    const visLabel = entry.visibility === "private" ? "🌐 Сделать публичной" : "🔒 Сделать приватной";
    buttons.push([
      Markup.button.callback(visLabel, `gandalf_vis_toggle:${entry.id}`),
      Markup.button.callback("📂 Переместить", `gandalf_move:${entry.id}`),
    ]);
  } else {
    buttons.push([
      Markup.button.callback("📂 Переместить", `gandalf_move:${entry.id}`),
    ]);
  }

  // Edit buttons
  buttons.push([
    Markup.button.callback("✏️ Название", `gandalf_edit_title:${entry.id}`),
    Markup.button.callback("💰 Цена", `gandalf_edit_price:${entry.id}`),
  ]);
  buttons.push([
    Markup.button.callback("📅 Дата", `gandalf_edit_date:${entry.id}`),
    Markup.button.callback("ℹ️ Доп. инфо", `gandalf_edit_info:${entry.id}`),
  ]);
  buttons.push([
    Markup.button.callback("🧹 Очистить поле", `gandalf_clear_menu:${entry.id}`),
  ]);

  if (filesCount > 0) {
    buttons.push([
      Markup.button.callback(`📎 Файлы (${filesCount})`, `gandalf_files:${entry.id}`),
    ]);
  }

  buttons.push([
    Markup.button.callback("🗑 Удалить", `gandalf_del:${entry.id}`),
  ]);

  return Markup.inlineKeyboard(buttons);
}

function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
}
