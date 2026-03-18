/**
 * /digest command handler — manage rubrics and channels for the digest mode.
 *
 * Subcommands:
 *   /digest           — show rubrics list
 *   /digest add <rubric> @channel — add channel to rubric
 *   /digest remove <rubric> @channel — remove channel from rubric
 *   /digest channels <rubric> — list channels in rubric
 *   /digest delete <rubric> — delete a rubric
 *   /digest pause <rubric> — pause rubric
 *   /digest resume <rubric> — resume rubric
 *   /digest now — run digest immediately
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isDatabaseAvailable } from "../db/connection.js";
import { getUserByTelegramId, ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { setUserMode } from "../middleware/expenseMode.js";
import { isDigestConfigured, isDigestReady, getUserDialogFolders, getChannelsFromFolder } from "../digest/telegramClient.js";
import {
  getRubricsByUser,
  getRubricByUserAndName,
  countRubricsByUser,
  createRubric,
  deleteRubric,
  toggleRubric,
  addChannel,
  removeChannel,
  getChannelsByRubric,
  countChannelsByRubric,
  countTotalChannels,
  MAX_RUBRICS_PER_USER,
  MAX_CHANNELS_PER_RUBRIC,
  MAX_CHANNELS_TOTAL,
} from "../digest/repository.js";
import { generateRubricMeta } from "../digest/summarizer.js";
import { runAllDigests } from "../digest/scheduler.js";
import { createLogger } from "../utils/logger.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import type { Telegraf } from "telegraf";

const log = createLogger("digest");

/** State for interactive rubric creation. */
interface RubricCreationState {
  step: "name" | "description";
  name?: string;
}

const rubricCreationStates = new Map<number, RubricCreationState>();

function getDigestKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📋 Мои рубрики", "▶️ Запустить сейчас"],
    ["➕ Создать рубрику", "📂 Импорт из папки"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

/** Stored bot reference for /digest now. */
let botRef: Telegraf | null = null;

/** Set bot reference (called from index.ts). */
export function setDigestBotRef(bot: Telegraf): void {
  botRef = bot;
}

/**
 * Main /digest command handler. Routes to subcommands.
 */
export async function handleDigestCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("Дайджест недоступен (нет подключения к базе данных).");
    return;
  }

  if (!await isDigestReady()) {
    if (!isDigestConfigured()) {
      await ctx.reply("Дайджест не настроен. Необходимо задать TELEGRAM_PARSER_API_ID и TELEGRAM_PARSER_API_HASH.");
    } else {
      await ctx.reply("Дайджест не готов: отсутствует MTProto-сессия. Выполните `npm run tg-auth` на сервере.");
    }
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
    await ctx.reply("📰 Дайджест доступен только для участников трайба. Обратитесь к администратору.");
    return;
  }

  await setUserMode(telegramId, "digest");

  // Update hamburger menu commands for digest mode
  await setModeMenuCommands(ctx, "digest");

  if (!ctx.message || !("text" in ctx.message)) {
    await showRubrics(ctx, telegramId);
    return;
  }
  const text = typeof ctx.message.text === "string" ? ctx.message.text.trim() : "";

  // If called from keyboard button (not a /digest command), just show rubrics
  if (!text.startsWith("/digest")) {
    await showRubrics(ctx, telegramId);
    return;
  }

  const args = text.replace(/^\/digest\s*/i, "").trim();

  if (!args) {
    await showRubrics(ctx, telegramId);
    return;
  }

  const parts = args.split(/\s+/);
  const sub = parts[0].toLowerCase();

  switch (sub) {
    case "now":
      await handleDigestNow(ctx, telegramId);
      break;
    case "add":
      await handleAddChannel(ctx, telegramId, parts.slice(1));
      break;
    case "remove":
      await handleRemoveChannel(ctx, telegramId, parts.slice(1));
      break;
    case "channels":
      await handleListChannels(ctx, telegramId, parts.slice(1).join(" "));
      break;
    case "delete":
      await handleDeleteRubric(ctx, telegramId, parts.slice(1).join(" "));
      break;
    case "pause":
      await handleToggleRubric(ctx, telegramId, parts.slice(1).join(" "), false);
      break;
    case "resume":
      await handleToggleRubric(ctx, telegramId, parts.slice(1).join(" "), true);
      break;
    default:
      // Treat as rubric creation: /digest <name> <description>
      await handleCreateRubric(ctx, telegramId, args);
      break;
  }
}

/** Show user's rubrics. */
async function showRubrics(ctx: Context, telegramId: number): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  const rubrics = await getRubricsByUser(dbUser.id);

  if (rubrics.length === 0) {
    await ctx.reply(
      "📰 *Режим дайджеста активирован*\n\n" +
      "У вас пока нет рубрик. Создайте первую:\n" +
      "`/digest Название рубрики — Описание тематики`\n\n" +
      "Пример:\n" +
      "`/digest DevOps и разработка — Новости разработки, DevOps, CI/CD, Kubernetes`",
      { parse_mode: "Markdown", ...getDigestKeyboard(isBootstrapAdmin(telegramId)) }
    );
    return;
  }

  const lines = rubrics.map((r) => {
    const status = r.isActive ? "✅" : "⏸";
    return `${status} ${r.emoji ?? "📰"} *${escapeMarkdown(r.name)}*`;
  });

  await ctx.reply(
    "📰 *Ваши рубрики:*\n\n" +
    lines.join("\n") +
    `\n\n📝 Рубрик: ${rubrics.length}/${MAX_RUBRICS_PER_USER}\n\n` +
    "Команды:\n" +
    "`/digest <название> — <описание>` — создать\n" +
    "`/digest channels <название>` — каналы\n" +
    "`/digest add <рубрика> @канал` — добавить\n" +
    "`/digest remove <рубрика> @канал` — удалить\n" +
    "`/digest pause <название>` — пауза\n" +
    "`/digest resume <название>` — возобновить\n" +
    "`/digest delete <название>` — удалить\n" +
    "`/digest now` — запустить сейчас",
    { parse_mode: "Markdown", ...getDigestKeyboard(isBootstrapAdmin(telegramId)) }
  );
}

/** Create a new rubric. Format: /digest Name — Description */
async function handleCreateRubric(
  ctx: Context,
  telegramId: number,
  args: string
): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // Check limit
  const count = await countRubricsByUser(dbUser.id);
  if (count >= MAX_RUBRICS_PER_USER) {
    await ctx.reply(`Достигнут лимит рубрик (${MAX_RUBRICS_PER_USER}). Удалите ненужные: /digest delete <название>`);
    return;
  }

  // Parse name and description
  const separatorIdx = args.indexOf("—");
  let name: string;
  let description: string;
  if (separatorIdx > 0) {
    name = args.slice(0, separatorIdx).trim();
    description = args.slice(separatorIdx + 1).trim();
  } else {
    name = args.trim();
    description = name;
  }

  if (!name || name.length > 100) {
    await ctx.reply("Название рубрики: от 1 до 100 символов.");
    return;
  }

  // Check uniqueness
  const existing = await getRubricByUserAndName(dbUser.id, name);
  if (existing) {
    await ctx.reply(`Рубрика «${name}» уже существует.`);
    return;
  }

  // Generate emoji and keywords via AI
  const statusMsg = await ctx.reply("Создаю рубрику...");
  const meta = await generateRubricMeta(name, description);

  const rubric = await createRubric({
    userId: dbUser.id,
    name,
    description,
    emoji: meta.emoji,
    keywords: meta.keywords,
  });

  const keywordsStr = meta.keywords.length > 0
    ? `\nКлючевые слова: ${meta.keywords.join(", ")}`
    : "";

  try {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `${rubric.emoji} Рубрика «${rubric.name}» создана!${keywordsStr}\n\n` +
      `Теперь добавьте каналы:\n/digest add ${rubric.name} @channel_username`
    );
  } catch {
    await ctx.reply(
      `${rubric.emoji} Рубрика «${rubric.name}» создана!${keywordsStr}\n\n` +
      `Теперь добавьте каналы:\n/digest add ${rubric.name} @channel_username`
    );
  }
}

/** Add a channel to a rubric. */
async function handleAddChannel(
  ctx: Context,
  telegramId: number,
  parts: string[]
): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // Parse: rubric_name @channel
  if (parts.length < 2) {
    await ctx.reply("Формат: /digest add <рубрика> @канал");
    return;
  }

  const channelRaw = parts[parts.length - 1];
  const rubricName = parts.slice(0, -1).join(" ");

  const rubric = await getRubricByUserAndName(dbUser.id, rubricName);
  if (!rubric) {
    await ctx.reply(`Рубрика «${rubricName}» не найдена.`);
    return;
  }

  // Check channel limit per rubric
  const channelCount = await countChannelsByRubric(rubric.id);
  if (channelCount >= MAX_CHANNELS_PER_RUBRIC) {
    await ctx.reply(`Достигнут лимит каналов в рубрике (${MAX_CHANNELS_PER_RUBRIC}).`);
    return;
  }

  // Check global channel limit
  const totalChannels = await countTotalChannels();
  if (totalChannels >= MAX_CHANNELS_TOTAL) {
    await ctx.reply(`Достигнут общий лимит каналов (${MAX_CHANNELS_TOTAL}).`);
    return;
  }

  const username = channelRaw.replace(/^@/, "").toLowerCase();
  if (!username || username.length < 5) {
    await ctx.reply("Укажите корректный @username канала (минимум 5 символов).");
    return;
  }

  const channel = await addChannel(rubric.id, username);
  await ctx.reply(
    `✅ Канал @${channel.channelUsername} добавлен в рубрику «${rubric.name}».`
  );
}

/** Remove a channel from a rubric. */
async function handleRemoveChannel(
  ctx: Context,
  telegramId: number,
  parts: string[]
): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  if (parts.length < 2) {
    await ctx.reply("Формат: /digest remove <рубрика> @канал");
    return;
  }

  const channelRaw = parts[parts.length - 1];
  const rubricName = parts.slice(0, -1).join(" ");

  const rubric = await getRubricByUserAndName(dbUser.id, rubricName);
  if (!rubric) {
    await ctx.reply(`Рубрика «${rubricName}» не найдена.`);
    return;
  }

  const username = channelRaw.replace(/^@/, "").toLowerCase();
  const removed = await removeChannel(rubric.id, username);
  if (removed) {
    await ctx.reply(`✅ Канал @${username} удалён из рубрики «${rubric.name}».`);
  } else {
    await ctx.reply(`Канал @${username} не найден в рубрике «${rubric.name}».`);
  }
}

/** List channels in a rubric. */
async function handleListChannels(
  ctx: Context,
  telegramId: number,
  rubricName: string
): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  if (!rubricName) {
    await ctx.reply("Формат: /digest channels <рубрика>");
    return;
  }

  const rubric = await getRubricByUserAndName(dbUser.id, rubricName.trim());
  if (!rubric) {
    await ctx.reply(`Рубрика «${rubricName}» не найдена.`);
    return;
  }

  const channels = await getChannelsByRubric(rubric.id);
  if (channels.length === 0) {
    await ctx.reply(
      `${rubric.emoji ?? "📰"} *${escapeMarkdown(rubric.name)}*\n\nКаналов нет. Добавьте:\n/digest add ${rubric.name} @channel`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const lines = channels.map((c, i) => {
    const title = c.channelTitle ? ` (${c.channelTitle})` : "";
    return `${i + 1}. @${c.channelUsername}${title}`;
  });

  try {
    await ctx.replyWithMarkdown(
      `${rubric.emoji ?? "📰"} *${escapeMarkdown(rubric.name)}*\n` +
      `Каналов: ${channels.length}/${MAX_CHANNELS_PER_RUBRIC}\n\n` +
      lines.join("\n")
    );
  } catch {
    await ctx.reply(
      `${rubric.emoji ?? "📰"} ${rubric.name}\nКаналов: ${channels.length}/${MAX_CHANNELS_PER_RUBRIC}\n\n` +
      lines.join("\n")
    );
  }
}

/** Delete a rubric. */
async function handleDeleteRubric(
  ctx: Context,
  telegramId: number,
  rubricName: string
): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  if (!rubricName) {
    await ctx.reply("Формат: /digest delete <рубрика>");
    return;
  }

  const rubric = await getRubricByUserAndName(dbUser.id, rubricName.trim());
  if (!rubric) {
    await ctx.reply(`Рубрика «${rubricName}» не найдена.`);
    return;
  }

  await deleteRubric(rubric.id, dbUser.id);
  await ctx.reply(`✅ Рубрика «${rubric.name}» удалена.`);
}

/** Pause or resume a rubric. */
async function handleToggleRubric(
  ctx: Context,
  telegramId: number,
  rubricName: string,
  isActive: boolean
): Promise<void> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  if (!rubricName) {
    await ctx.reply(`Формат: /digest ${isActive ? "resume" : "pause"} <рубрика>`);
    return;
  }

  const rubric = await getRubricByUserAndName(dbUser.id, rubricName.trim());
  if (!rubric) {
    await ctx.reply(`Рубрика «${rubricName}» не найдена.`);
    return;
  }

  await toggleRubric(rubric.id, dbUser.id, isActive);
  const status = isActive ? "▶️ возобновлена" : "⏸ приостановлена";
  await ctx.reply(`${rubric.emoji ?? "📰"} Рубрика «${rubric.name}» ${status}.`);
}

/** Run digest immediately. */
async function handleDigestNow(ctx: Context, telegramId: number): Promise<void> {
  if (!botRef) {
    await ctx.reply("Ошибка: бот не инициализирован.");
    return;
  }

  await ctx.reply("⏳ Запускаю дайджест... Это может занять несколько минут.");

  try {
    const count = await runAllDigests(botRef);
    if (count === 0) {
      await ctx.reply("Нет активных рубрик с каналами. Создайте рубрику и добавьте каналы.");
    }
  } catch (err) {
    log.error("Manual digest run failed:", err);
    const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
    await ctx.reply(`❌ Ошибка дайджеста: ${msg}`);
  }
}

/** Handle "Мои рубрики" keyboard button. */
export async function handleRubricsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  await showRubrics(ctx, telegramId);
}

/** Handle "Запустить сейчас" keyboard button. */
export async function handleDigestNowButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  await handleDigestNow(ctx, telegramId);
}

/** Handle "➕ Создать рубрику" keyboard button — start interactive creation. */
export async function handleCreateRubricButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  rubricCreationStates.set(telegramId, { step: "name" });
  await ctx.reply("Введите название рубрики:");
}

/**
 * Handle text input in digest mode for interactive rubric creation.
 * Returns true if the message was consumed.
 */
export async function handleDigestText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const state = rubricCreationStates.get(telegramId);
  if (!state) return false;

  const text = ctx.message.text.trim();

  if (state.step === "name") {
    if (!text || text.length > 100) {
      await ctx.reply("Название рубрики: от 1 до 100 символов. Попробуйте ещё раз:");
      return true;
    }
    rubricCreationStates.set(telegramId, { step: "description", name: text });
    await ctx.reply(`Название: «${text}»\n\nТеперь введите описание тематики (или отправьте «—» чтобы пропустить):`);
    return true;
  }

  if (state.step === "description" && state.name) {
    rubricCreationStates.delete(telegramId);
    const description = text === "—" ? state.name : text;
    await handleCreateRubric(ctx, telegramId, `${state.name} — ${description}`);
    return true;
  }

  return false;
}

// ─── Folder import ──────────────────────────────────────────────────────

/** State for folder import flow: maps telegramId → rubric name to import into. */
const folderImportStates = new Map<number, { rubricName: string }>();

/** Handle "📂 Импорт из папки" keyboard button. */
export async function handleFolderImportButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!await isDigestReady()) {
    if (!isDigestConfigured()) {
      await ctx.reply("Telegram Parser не настроен.");
    } else {
      await ctx.reply("Telegram Parser не готов: отсутствует MTProto-сессия. Выполните `npm run tg-auth` на сервере.");
    }
    return;
  }

  const statusMsg = await ctx.reply("Загружаю папки Telegram...");

  try {
    const folders = await getUserDialogFolders();
    if (folders.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsg.message_id, undefined,
        "У вас нет папок в Telegram. Создайте папку с каналами в настройках Telegram."
      );
      return;
    }

    const buttons = folders.map((f) => [
      Markup.button.callback(`📂 ${f.title}`, `digest_folder:${f.id}`),
    ]);

    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsg.message_id, undefined,
      "Выберите папку для импорта каналов:",
      { ...Markup.inlineKeyboard(buttons) }
    );
  } catch (err) {
    log.error("Failed to get folders:", err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsg.message_id, undefined,
      "Ошибка при загрузке папок."
    );
  }
}

/** Handle folder selection callback — show channels and ask which rubric. */
export async function handleDigestFolderCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^digest_folder:(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const folderId = parseInt(match[1], 10);
  await ctx.answerCbQuery("Загружаю каналы...");

  try {
    const channels = await getChannelsFromFolder(folderId);
    if (channels.length === 0) {
      await ctx.editMessageText("В этой папке нет каналов.");
      return;
    }

    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return;

    const rubrics = await getRubricsByUser(dbUser.id);
    if (rubrics.length === 0) {
      await ctx.editMessageText(
        `Найдено каналов: ${channels.length}\n\n` +
        `Но у вас нет рубрик. Сначала создайте рубрику, затем импортируйте каналы.`
      );
      return;
    }

    const buttons = rubrics.map((r) => [
      Markup.button.callback(
        `${r.emoji ?? "📰"} ${r.name}`,
        `digest_folder_to:${folderId}:${r.id}`
      ),
    ]);

    await ctx.editMessageText(
      `Найдено каналов: ${channels.length}\n\nВыберите рубрику для импорта:`,
      { ...Markup.inlineKeyboard(buttons) }
    );
  } catch (err) {
    log.error("Failed to get channels from folder:", err);
    await ctx.editMessageText("Ошибка при загрузке каналов.");
  }
}

/** Handle folder-to-rubric import callback. */
export async function handleDigestFolderToCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^digest_folder_to:(\d+):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const folderId = parseInt(match[1], 10);
  const rubricId = parseInt(match[2], 10);
  await ctx.answerCbQuery("Импортирую...");

  try {
    const channels = await getChannelsFromFolder(folderId);
    let added = 0;
    let skipped = 0;

    for (const username of channels) {
      try {
        await addChannel(rubricId, username);
        added++;
      } catch {
        skipped++; // Already exists or error
      }
    }

    await ctx.editMessageText(
      `✅ Импорт завершён!\n\nДобавлено: ${added}\nПропущено (уже есть): ${skipped}`
    );
  } catch (err) {
    log.error("Failed to import channels:", err);
    await ctx.editMessageText("Ошибка при импорте каналов.");
  }
}

