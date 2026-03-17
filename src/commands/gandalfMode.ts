/**
 * Gandalf mode command handler.
 * Tribe-wide structured information tracker with categories, entries, files.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  createCategory,
  getCategoriesByTribe,
  getCategoryById,
  deleteCategory,
  createEntry,
  getEntriesByCategory,
  getEntriesByTribe,
  getEntryById,
  deleteEntry,
  updateEntry,
  countEntriesByCategory,
  countEntriesByTribe,
  addFileToEntry,
  getFilesByEntry,
  getStatsByCategory,
  getStatsByYear,
  getStatsByUser,
  getLatestEntryByUser,
} from "../gandalf/repository.js";
import type { GandalfEntry } from "../gandalf/repository.js";
import { extractGandalfIntent } from "../voice/extractGandalfIntent.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";
import { escapeMarkdown } from "../utils/markdown.js";

const log = createLogger("gandalf-mode");

const ENTRIES_PAGE_SIZE = 5;

// ─── State ──────────────────────────────────────────────────────────────

interface EntryCreationState {
  step: "title" | "price" | "optional";
  categoryId: number;
  title?: string;
  price?: number | null;
  entryId?: number;
}

const creationStates = new Map<number, EntryCreationState>();
const categoryCreationWaiting = new Set<number>();

// Track which entry user wants to add optional fields to
const optionalFieldStates = new Map<number, { entryId: number; field: "next_date" | "additional_info" }>();

function getGandalfKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📦 Категории", "➕ Новая запись"],
    ["📊 Статистика", "📋 Все записи"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleGandalfCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("🧙 Гэндальф недоступен (нет подключения к базе данных).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  if (!dbUser.tribeId) {
    await ctx.reply("🧙 Гэндальф доступен только для участников семьи. Обратитесь к администратору.");
    return;
  }

  await setUserMode(telegramId, "gandalf");
  await setModeMenuCommands(ctx, "gandalf");

  const isAdmin = isBootstrapAdmin(telegramId);
  await ctx.reply(
    "🧙 *Режим Гэндальф активирован*\n\n" +
    "Общий семейный трекер записей.\n" +
    "Создавайте категории (ЖКХ, Ремонт, Здоровье и т.д.),\n" +
    "добавляйте записи текстом или голосом.\n" +
    "Прикрепляйте фото и документы.\n\n" +
    "Все участники семьи видят все записи.",
    { parse_mode: "Markdown", ...getGandalfKeyboard(isAdmin) }
  );
}

// ─── Categories ─────────────────────────────────────────────────────────

export async function handleGandalfCategoriesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) {
    await ctx.reply("Вы не в семье. Обратитесь к администратору.");
    return;
  }

  const categories = await getCategoriesByTribe(dbUser.tribeId);

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
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  const count = await countEntriesByCategory(dbUser.tribeId, categoryId);
  const entries = await getEntriesByCategory(dbUser.tribeId, categoryId, ENTRIES_PAGE_SIZE, 0);

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
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

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
  if (!dbUser?.tribeId) {
    await ctx.reply("Вы не в семье. Обратитесь к администратору.");
    return;
  }

  const categories = await getCategoriesByTribe(dbUser.tribeId);

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
  creationStates.set(telegramId, { step: "title", categoryId });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Введите название записи:");
}

// ─── All Entries ────────────────────────────────────────────────────────

export async function handleGandalfAllEntriesButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) return;

  const total = await countEntriesByTribe(dbUser.tribeId);
  if (total === 0) {
    await ctx.reply("Записей пока нет. Нажмите «➕ Новая запись» чтобы создать первую.");
    return;
  }

  const entries = await getEntriesByTribe(dbUser.tribeId, ENTRIES_PAGE_SIZE, 0);
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
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  const isAllEntries = categoryId === 0;
  const total = isAllEntries
    ? await countEntriesByTribe(dbUser.tribeId)
    : await countEntriesByCategory(dbUser.tribeId, categoryId);
  const entries = isAllEntries
    ? await getEntriesByTribe(dbUser.tribeId, ENTRIES_PAGE_SIZE, offset)
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
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

  // View entry detail
  const viewMatch = data.match(/^gandalf_view:(\d+)$/);
  if (viewMatch) {
    const entryId = parseInt(viewMatch[1], 10);
    const entry = await getEntryById(entryId, dbUser.tribeId);
    if (!entry) {
      await ctx.answerCbQuery("Запись не найдена");
      return;
    }
    const files = await getFilesByEntry(entryId);
    await ctx.answerCbQuery();
    await ctx.editMessageText(formatSingleEntry(entry, files.length), {
      parse_mode: "Markdown",
      ...buildSingleEntryButtons(entry, files.length),
    });
    return;
  }

  // Delete entry
  const delMatch = data.match(/^gandalf_del:(\d+)$/);
  if (delMatch) {
    const entryId = parseInt(delMatch[1], 10);
    await deleteEntry(entryId, dbUser.tribeId);
    logAction(dbUser.id, telegramId, "gandalf_entry_delete", { entryId });
    await ctx.answerCbQuery("Запись удалена");
    await ctx.editMessageText("✅ Запись удалена.");
    return;
  }

  await ctx.answerCbQuery();
}

// ─── Entry Files ────────────────────────────────────────────────────────

export async function handleGandalfFilesCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^gandalf_files:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const entryId = parseInt(match[1], 10);
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser?.tribeId) { await ctx.answerCbQuery(); return; }

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

  await ctx.reply("Выберите вид статистики:", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("📦 По категориям", "gandalf_stats:categories")],
      [Markup.button.callback("📅 По годам", "gandalf_stats:years")],
      [Markup.button.callback("👥 По участникам", "gandalf_stats:users")],
    ]),
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
  if (!dbUser?.tribeId) {
    await ctx.answerCbQuery("Вы не в семье");
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
  if (!dbUser?.tribeId) return false;

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

      const category = await createCategory(dbUser.tribeId, name, emoji, dbUser.id);
      logAction(dbUser.id, telegramId, "gandalf_category_create", { categoryId: category.id, name });
      await ctx.reply(`${category.emoji} Категория «${category.name}» создана!`);
    } catch (err) {
      log.error("Error creating gandalf category:", err);
      await ctx.reply("Ошибка при создании категории. Возможно, такая уже существует.");
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
        await updateEntry(optState.entryId, dbUser.tribeId, { nextDate: parsed });
        await ctx.reply(`📅 Дата установлена: ${parsed.toLocaleDateString("ru-RU")}`);
      } else {
        await updateEntry(optState.entryId, dbUser.tribeId, { additionalInfo: text });
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
    creationStates.delete(telegramId);

    let price: number | null = null;
    if (text !== "-") {
      const parsed = parseFloat(text.replace(/\s/g, "").replace(",", "."));
      if (!isNaN(parsed) && parsed >= 0) {
        price = parsed;
      } else {
        await ctx.reply("Некорректная цена. Запись создана без цены.");
      }
    }

    try {
      const entry = await createEntry({
        tribeId: dbUser.tribeId,
        categoryId: state.categoryId,
        title: state.title!,
        price,
        addedByUserId: dbUser.id,
        inputMethod: "text",
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
  if (!dbUser?.tribeId) return;

  try {
    const categories = await getCategoriesByTribe(dbUser.tribeId);
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
        "Это не похоже на запись для трекера. Скажите что записать, например: «Запиши в ЖКХ показания счётчика 123»."
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
        // Have enough to create, find category
        const cat = categories.find(
          (c) => c.name.toLowerCase() === result.category!.toLowerCase()
        );
        if (cat) {
          const entry = await createEntry({
            tribeId: dbUser.tribeId,
            categoryId: cat.id,
            title: result.title,
            price: result.price,
            addedByUserId: dbUser.id,
            inputMethod: "voice",
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
    const entry = await createEntry({
      tribeId: dbUser.tribeId,
      categoryId: cat.id,
      title: result.title,
      price: result.price,
      addedByUserId: dbUser.id,
      nextDate: nextDate && !isNaN(nextDate.getTime()) ? nextDate : null,
      additionalInfo: result.additionalInfo,
      inputMethod: "voice",
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

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `✅ Запись из голосового сохранена\n${cat.emoji} ${cat.name}\n📝 ${result.title}${priceStr}${dateStr}${infoStr}`
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
  if (!dbUser?.tribeId) return false;

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
  const latestEntry = await getLatestEntryByUser(dbUser.tribeId, dbUser.id);
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
    const date = e.createdAt.toLocaleDateString("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const author = e.addedByName ? ` — ${e.addedByName}` : "";
    return `*${i + 1}.* ${cat}${priceStr}\n${escapeMarkdown(e.title)}\n_${date}${author}_`;
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

  const parts = [
    `🧙 *Запись #${entry.id}*`,
    cat,
    `📝 ${escapeMarkdown(entry.title)}`,
  ];
  if (priceStr) parts.push(priceStr.trim());
  if (dateStr) parts.push(dateStr.trim());
  if (infoStr) parts.push(infoStr.trim());
  parts.push(`${date} | ${method}`);
  if (author) parts.push(author);
  if (filesStr) parts.push(filesStr.trim());

  return parts.join("\n");
}

function buildEntryButtons(entries: GandalfEntry[]) {
  const buttons = entries.map((e) => [
    Markup.button.callback(`🧙 #${e.id}`, `gandalf_view:${e.id}`),
    Markup.button.callback("🗑", `gandalf_del:${e.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

function buildSingleEntryButtons(entry: GandalfEntry, filesCount: number) {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

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
