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
import { setUserMode } from "../middleware/userMode.js";
import { isDigestConfigured, isDigestReady, getUserDialogFolders, getChannelsFromFolder } from "../digest/telegramClient.js";
import { hasActiveSession, getClientForUser } from "../digest/sessionManager.js";
import {
  getRubricsByUser,
  getRubricByUserAndName,
  getRubricByIdAndUser,
  countRubricsByUser,
  createRubric,
  deleteRubric,
  toggleRubric,
  updateRubric,
  addChannel,
  removeChannel,
  removeChannelById,
  getChannelById,
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

/** State for inline channel-add flow (text input after pressing ➕). */
const channelAddStates = new Map<number, { rubricId: number }>();

/** State for rubric editing (name/description text input). */
const rubricEditStates = new Map<number, { rubricId: number; field: "name" | "description" }>();

/** Truncate string to maxLen, appending "…" if needed. */
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

function getDigestKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📋 Мои рубрики", "▶️ Запустить сейчас"],
    ["➕ Создать рубрику", "📂 Импорт из папки"],
    ["🔑 Привязать Telegram"],
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
      await ctx.reply("Дайджест не готов: отсутствует MTProto-сессия. Задайте TELEGRAM_SESSION в env или выполните `npm run tg-auth`.");
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

/** Build inline keyboard for rubrics list. */
function buildRubricsListKeyboard(rubrics: import("../digest/types.js").DigestRubric[]) {
  const buttons = rubrics.map((r) => {
    const status = r.isActive ? "✅" : "⏸";
    const label = truncate(`${status} ${r.emoji ?? "📰"} ${r.name}`, 40);
    return [Markup.button.callback(label, `drub_view:${r.id}`)];
  });
  return Markup.inlineKeyboard(buttons);
}

/** Build rubrics list message text with rubric details. */
function buildRubricsListText(rubrics: import("../digest/types.js").DigestRubric[]): string {
  const header = `📰 Ваши рубрики (${rubrics.length}/${MAX_RUBRICS_PER_USER}):`;
  const lines = rubrics.map((r, i) => {
    const status = r.isActive ? "✅" : "⏸";
    const emoji = r.emoji ?? "📰";
    const desc = r.description ? ` — ${truncate(r.description, 50)}` : "";
    return `${i + 1}. ${status} ${emoji} ${r.name}${desc}`;
  });
  return `${header}\n\n${lines.join("\n")}\n\nНажмите на рубрику для настройки:`;
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
      "У вас пока нет рубрик\\. Создайте первую кнопкой «➕ Создать рубрику» или командой:\n" +
      "`/digest Название рубрики — Описание тематики`",
      { parse_mode: "MarkdownV2", ...getDigestKeyboard(isBootstrapAdmin(telegramId)) }
    );
    return;
  }

  await ctx.reply("📰 Дайджест", getDigestKeyboard(isBootstrapAdmin(telegramId)));
  await ctx.reply(buildRubricsListText(rubrics), buildRubricsListKeyboard(rubrics));
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

// ─── Inline callback handlers ────────────────────────────────────────────

/** Helper: extract numeric id from callback data like "drub_view:123". */
function extractId(data: string): number {
  const idx = data.indexOf(":");
  return idx >= 0 ? parseInt(data.slice(idx + 1), 10) : NaN;
}

/** Helper: get rubric with ownership check, answering callback on failure. */
async function getRubricForCallback(
  ctx: Context,
  rubricId: number
): Promise<{ rubric: import("../digest/types.js").DigestRubric; dbUser: { id: number } } | null> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return null;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден");
    return null;
  }

  if (isNaN(rubricId)) {
    await ctx.answerCbQuery("Некорректные данные");
    return null;
  }

  const rubric = await getRubricByIdAndUser(rubricId, dbUser.id);
  if (!rubric) {
    await ctx.answerCbQuery("Рубрика не найдена");
    try {
      const rubrics = await getRubricsByUser(dbUser.id);
      if (rubrics.length > 0) {
        await ctx.editMessageText(buildRubricsListText(rubrics), buildRubricsListKeyboard(rubrics));
      } else {
        await ctx.editMessageText("У вас пока нет рубрик.");
      }
    } catch { /* message unchanged */ }
    return null;
  }

  return { rubric, dbUser };
}

/** Build detail view for a rubric. */
async function buildRubricDetailView(rubric: import("../digest/types.js").DigestRubric) {
  const channelCount = await countChannelsByRubric(rubric.id);
  const status = rubric.isActive ? "✅ Активна" : "⏸ На паузе";
  const emoji = rubric.emoji ?? "📰";

  const text =
    `${emoji} ${rubric.name}\n` +
    `Статус: ${status} | Каналов: ${channelCount}/${MAX_CHANNELS_PER_RUBRIC}`;

  const toggleBtn = rubric.isActive
    ? Markup.button.callback("⏸ Пауза", `drub_pause:${rubric.id}`)
    : Markup.button.callback("▶️ Возобновить", `drub_resume:${rubric.id}`);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`📋 Каналы (${channelCount})`, `drub_ch:${rubric.id}`), toggleBtn],
    [Markup.button.callback("✏️ Изменить", `drub_edit:${rubric.id}`), Markup.button.callback("📂 Импорт из папки", `drub_import:${rubric.id}`)],
    [Markup.button.callback("🗑 Удалить", `drub_del:${rubric.id}`), Markup.button.callback("◀️ Назад", "drub_back")],
  ]);

  return { text, keyboard };
}

/** drub_view:{id} — show rubric details. */
export async function handleRubricViewCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  // Clear any pending channel-add state
  const telegramId = ctx.from?.id;
  if (telegramId != null) channelAddStates.delete(telegramId);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  await ctx.answerCbQuery();
  const { text, keyboard } = await buildRubricDetailView(result.rubric);
  try {
    await ctx.editMessageText(text, keyboard);
  } catch { /* content unchanged */ }
}

/** drub_pause:{id} / drub_resume:{id} — toggle rubric. */
export async function handleRubricToggleCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const rubricId = extractId(data);
  const shouldActivate = data.startsWith("drub_resume:");

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  await toggleRubric(result.rubric.id, result.dbUser.id, shouldActivate);
  await ctx.answerCbQuery(shouldActivate ? "▶️ Возобновлена" : "⏸ Приостановлена");

  // Refresh rubric data and show updated detail view
  const updated = await getRubricByIdAndUser(rubricId, result.dbUser.id);
  if (!updated) return;

  const { text, keyboard } = await buildRubricDetailView(updated);
  try {
    await ctx.editMessageText(text, keyboard);
  } catch { /* content unchanged */ }
}

/** drub_del:{id} — ask for delete confirmation. */
export async function handleRubricDeleteCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  await ctx.answerCbQuery();

  const name = result.rubric.name;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Да, удалить", `drub_del_yes:${rubricId}`),
      Markup.button.callback("❌ Отмена", `drub_view:${rubricId}`),
    ],
  ]);

  try {
    await ctx.editMessageText(
      `Удалить рубрику «${name}»? Все каналы будут отвязаны.`,
      keyboard
    );
  } catch { /* content unchanged */ }
}

/** drub_del_yes:{id} — confirm delete, show updated list. */
export async function handleRubricDeleteConfirmCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  const name = result.rubric.name;
  await deleteRubric(rubricId, result.dbUser.id);
  await ctx.answerCbQuery(`Рубрика «${name}» удалена`);

  // Show updated list
  const rubrics = await getRubricsByUser(result.dbUser.id);
  try {
    if (rubrics.length > 0) {
      await ctx.editMessageText(buildRubricsListText(rubrics), buildRubricsListKeyboard(rubrics));
    } else {
      await ctx.editMessageText("У вас пока нет рубрик. Создайте кнопкой «➕ Создать рубрику».");
    }
  } catch { /* content unchanged */ }
}

/** Build channel list view (text + inline keyboard) for a rubric. */
async function buildChannelListView(rubric: import("../digest/types.js").DigestRubric) {
  const channels = await getChannelsByRubric(rubric.id);
  const emoji = rubric.emoji ?? "📰";

  if (channels.length === 0) {
    return {
      text: `${emoji} ${rubric.name} — Каналов нет`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("➕ Добавить канал", `drub_ch_add:${rubric.id}`)],
        [Markup.button.callback("◀️ Назад", `drub_view:${rubric.id}`)],
      ]),
    };
  }

  const lines = channels.map((c, i) => {
    const title = c.channelTitle ? ` (${c.channelTitle})` : "";
    return `${i + 1}. @${c.channelUsername}${title}`;
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < channels.length; i += 2) {
    const row: ReturnType<typeof Markup.button.callback>[] = [];
    row.push(Markup.button.callback(
      `🗑 ${truncate(channels[i].channelUsername, 20)}`,
      `drub_ch_rm:${channels[i].id}`
    ));
    if (i + 1 < channels.length) {
      row.push(Markup.button.callback(
        `🗑 ${truncate(channels[i + 1].channelUsername, 20)}`,
        `drub_ch_rm:${channels[i + 1].id}`
      ));
    }
    rows.push(row);
  }

  rows.push([
    Markup.button.callback("➕ Добавить канал", `drub_ch_add:${rubric.id}`),
    Markup.button.callback("◀️ Назад", `drub_view:${rubric.id}`),
  ]);

  return {
    text: `${emoji} ${rubric.name} — Каналы (${channels.length}/${MAX_CHANNELS_PER_RUBRIC}):\n\n` + lines.join("\n"),
    keyboard: Markup.inlineKeyboard(rows),
  };
}

/** drub_ch:{id} — show channels list with remove buttons. */
export async function handleRubricChannelsCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  await ctx.answerCbQuery();

  const { text, keyboard } = await buildChannelListView(result.rubric);
  try {
    await ctx.editMessageText(text, keyboard);
  } catch { /* content unchanged */ }
}

/** drub_ch_rm:{channelId} — remove a channel, refresh list. */
export async function handleChannelRemoveCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const channelId = extractId(ctx.callbackQuery.data);
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (isNaN(channelId)) {
    await ctx.answerCbQuery("Некорректные данные");
    return;
  }

  // Look up channel directly instead of iterating all rubrics (N+1 fix)
  const channel = await getChannelById(channelId);
  if (!channel) {
    await ctx.answerCbQuery("Канал не найден");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден");
    return;
  }

  // Verify rubric ownership
  const rubric = await getRubricByIdAndUser(channel.rubricId, dbUser.id);
  if (!rubric) {
    await ctx.answerCbQuery("Канал не найден");
    return;
  }

  const removed = await removeChannelById(channelId, rubric.id);
  if (!removed) {
    await ctx.answerCbQuery("Канал не найден");
    return;
  }

  await ctx.answerCbQuery("Канал удалён");

  const { text, keyboard } = await buildChannelListView(rubric);
  try {
    await ctx.editMessageText(text, keyboard);
  } catch { /* content unchanged */ }
}

/** drub_ch_add:{rubricId} — start text input for adding a channel. */
export async function handleChannelAddCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  // Check channel limits
  const channelCount = await countChannelsByRubric(rubricId);
  if (channelCount >= MAX_CHANNELS_PER_RUBRIC) {
    await ctx.answerCbQuery(`Лимит каналов (${MAX_CHANNELS_PER_RUBRIC})`);
    return;
  }

  const totalChannels = await countTotalChannels();
  if (totalChannels >= MAX_CHANNELS_TOTAL) {
    await ctx.answerCbQuery(`Общий лимит каналов (${MAX_CHANNELS_TOTAL})`);
    return;
  }

  const telegramId = ctx.from!.id;
  channelAddStates.set(telegramId, { rubricId });
  await ctx.answerCbQuery();
  await ctx.reply(`Отправьте @username канала для рубрики «${result.rubric.name}»:`);
}

/** drub_back — show rubrics list. */
export async function handleRubricListCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  // Clear any pending channel-add state
  channelAddStates.delete(telegramId);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден");
    return;
  }

  await ctx.answerCbQuery();

  const rubrics = await getRubricsByUser(dbUser.id);
  try {
    if (rubrics.length > 0) {
      await ctx.editMessageText(buildRubricsListText(rubrics), buildRubricsListKeyboard(rubrics));
    } else {
      await ctx.editMessageText("У вас пока нет рубрик. Создайте кнопкой «➕ Создать рубрику».");
    }
  } catch { /* content unchanged */ }
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

  const text = ctx.message.text.trim();

  // Handle rubric edit text input (name/description)
  const editState = rubricEditStates.get(telegramId);
  if (editState) {
    rubricEditStates.delete(telegramId);

    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return true;

    const rubric = await getRubricByIdAndUser(editState.rubricId, dbUser.id);
    if (!rubric) {
      await ctx.reply("Рубрика не найдена.");
      return true;
    }

    if (editState.field === "name") {
      if (!text || text.length > 100) {
        await ctx.reply("Название рубрики: от 1 до 100 символов. Попробуйте ещё раз.");
        rubricEditStates.set(telegramId, editState);
        return true;
      }
      // Check uniqueness
      const existing = await getRubricByUserAndName(dbUser.id, text);
      if (existing && existing.id !== editState.rubricId) {
        await ctx.reply(`Рубрика «${text}» уже существует. Введите другое название:`);
        rubricEditStates.set(telegramId, editState);
        return true;
      }
      await updateRubric(editState.rubricId, { name: text });
      await ctx.reply(`✅ Название изменено на «${text}».`);
    } else {
      const desc = text === "—" ? null : text;
      await updateRubric(editState.rubricId, { description: desc });
      await ctx.reply(`✅ Описание ${desc ? "обновлено" : "очищено"}.`);
    }
    return true;
  }

  // Handle channel-add text input (from ➕ inline button)
  const channelState = channelAddStates.get(telegramId);
  if (channelState) {
    channelAddStates.delete(telegramId);

    const username = text.replace(/^@/, "").toLowerCase();
    if (!username || username.length < 5) {
      await ctx.reply("Укажите корректный @username канала (минимум 5 символов).");
      return true;
    }

    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return true;

    const rubric = await getRubricByIdAndUser(channelState.rubricId, dbUser.id);
    if (!rubric) {
      await ctx.reply("Рубрика не найдена.");
      return true;
    }

    // Check limits
    const channelCount = await countChannelsByRubric(rubric.id);
    if (channelCount >= MAX_CHANNELS_PER_RUBRIC) {
      await ctx.reply(`Достигнут лимит каналов в рубрике (${MAX_CHANNELS_PER_RUBRIC}).`);
      return true;
    }

    const totalChannels = await countTotalChannels();
    if (totalChannels >= MAX_CHANNELS_TOTAL) {
      await ctx.reply(`Достигнут общий лимит каналов (${MAX_CHANNELS_TOTAL}).`);
      return true;
    }

    const channel = await addChannel(rubric.id, username);
    await ctx.reply(`✅ Канал @${channel.channelUsername} добавлен в рубрику «${rubric.name}».`);
    return true;
  }

  const state = rubricCreationStates.get(telegramId);
  if (!state) return false;

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

// ─── Rubric editing callbacks ────────────────────────────────────────────

/** drub_edit:{id} — show edit menu for a rubric. */
export async function handleRubricEditCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  await ctx.answerCbQuery();

  const { rubric } = result;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✏️ Изменить название", `drub_edit_name:${rubricId}`)],
    [Markup.button.callback("📝 Изменить описание", `drub_edit_desc:${rubricId}`)],
    [Markup.button.callback("🎨 Перегенерировать эмодзи", `drub_edit_emoji:${rubricId}`)],
    [Markup.button.callback("◀️ Назад к рубрике", `drub_view:${rubricId}`)],
  ]);

  try {
    await ctx.editMessageText(
      `✏️ Редактирование «${rubric.name}»\n\n` +
      `Название: ${rubric.name}\n` +
      `Описание: ${rubric.description ?? "—"}\n` +
      `Эмодзи: ${rubric.emoji ?? "📰"}`,
      keyboard
    );
  } catch { /* content unchanged */ }
}

/** drub_edit_name:{id} — start editing rubric name. */
export async function handleRubricEditNameCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  const telegramId = ctx.from!.id;
  rubricEditStates.set(telegramId, { rubricId, field: "name" });
  await ctx.answerCbQuery();
  await ctx.reply(`Введите новое название рубрики (текущее: «${result.rubric.name}»):`);
}

/** drub_edit_desc:{id} — start editing rubric description. */
export async function handleRubricEditDescCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  const telegramId = ctx.from!.id;
  rubricEditStates.set(telegramId, { rubricId, field: "description" });
  await ctx.answerCbQuery();
  await ctx.reply(`Введите новое описание рубрики (или «—» чтобы очистить):`);
}

/** drub_edit_emoji:{id} — regenerate emoji and keywords via AI. */
export async function handleRubricEditEmojiCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  const { rubric } = result;
  await ctx.answerCbQuery("Генерирую...");

  try {
    const meta = await generateRubricMeta(rubric.name, rubric.description ?? rubric.name);
    await updateRubric(rubricId, { emoji: meta.emoji, keywords: meta.keywords });

    const updated = await getRubricByIdAndUser(rubricId, result.dbUser.id);
    if (!updated) return;

    const { text, keyboard } = await buildRubricDetailView(updated);
    try {
      await ctx.editMessageText(text, keyboard);
    } catch { /* content unchanged */ }

    await ctx.reply(`🎨 Эмодзи обновлён: ${meta.emoji}\nКлючевые слова: ${meta.keywords.join(", ") || "—"}`);
  } catch (err) {
    log.error("Failed to regenerate emoji:", err);
    await ctx.reply("❌ Не удалось перегенерировать эмодзи.");
  }
}

/** drub_import:{rubricId} — show folder list for import into specific rubric. */
export async function handleRubricFolderImportCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const rubricId = extractId(ctx.callbackQuery.data);
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  if (!isDigestConfigured()) {
    await ctx.answerCbQuery("Telegram Parser не настроен");
    return;
  }

  const dbUser = result.dbUser;
  const userHasSession = await hasActiveSession(dbUser.id);
  const adminReady = await isDigestReady();

  if (!userHasSession && !adminReady) {
    await ctx.answerCbQuery("Привяжите Telegram-аккаунт");
    return;
  }

  await ctx.answerCbQuery("Загружаю папки...");

  try {
    let userClient: import("telegram").TelegramClient | undefined;
    if (userHasSession) {
      try {
        userClient = await getClientForUser(dbUser.id);
      } catch (err) {
        log.warn(`Failed to get user client for ${dbUser.id}, falling back to admin:`, err);
      }
    }

    const folders = await getUserDialogFolders(userClient);
    if (folders.length === 0) {
      try {
        await ctx.editMessageText("У вас нет папок в Telegram. Создайте папку с каналами в настройках Telegram.");
      } catch { /* content unchanged */ }
      return;
    }

    // Store client for subsequent callbacks
    if (userClient) {
      folderImportClients.set(telegramId, dbUser.id);
    } else {
      folderImportClients.delete(telegramId);
    }

    const buttons = folders.map((f) => [
      Markup.button.callback(`📂 ${f.title}`, `drub_import_folder:${rubricId}:${f.id}`),
    ]);
    buttons.push([Markup.button.callback("◀️ Назад", `drub_view:${rubricId}`)]);

    try {
      await ctx.editMessageText(
        `Импорт каналов в «${result.rubric.name}»\nВыберите папку:`,
        { ...Markup.inlineKeyboard(buttons) }
      );
    } catch { /* content unchanged */ }
  } catch (err) {
    log.error("Failed to get folders for rubric import:", err);
    try {
      await ctx.editMessageText("Ошибка при загрузке папок.");
    } catch { /* content unchanged */ }
  }
}

/** drub_import_folder:{rubricId}:{folderId} — import channels from folder into rubric. */
export async function handleRubricFolderImportToCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const match = ctx.callbackQuery.data.match(/^drub_import_folder:(\d+):(\d+)$/);
  if (!match) { await ctx.answerCbQuery(); return; }

  const rubricId = parseInt(match[1], 10);
  const folderId = parseInt(match[2], 10);

  const result = await getRubricForCallback(ctx, rubricId);
  if (!result) return;

  await ctx.answerCbQuery("Импортирую...");

  try {
    const userClient = await resolveUserClient(telegramId);
    const channels = await getChannelsFromFolder(folderId, userClient);

    if (channels.length === 0) {
      try {
        await ctx.editMessageText(
          "В этой папке нет публичных каналов (с @username).\nПриватные каналы пока не поддерживаются."
        );
      } catch { /* content unchanged */ }
      return;
    }

    let added = 0;
    let skipped = 0;

    for (const username of channels) {
      try {
        await addChannel(rubricId, username);
        added++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to add channel @${username} to rubric ${rubricId}: ${msg}`);
        skipped++;
      }
    }

    try {
      await ctx.editMessageText(
        `✅ Импорт в «${result.rubric.name}» завершён!\n\nДобавлено: ${added}\nПропущено (уже есть): ${skipped}`
      );
    } catch { /* content unchanged */ }
  } catch (err) {
    log.error("Failed to import channels to rubric:", err);
    try {
      await ctx.editMessageText("Ошибка при импорте каналов.");
    } catch { /* content unchanged */ }
  }
}

// ─── Folder import ──────────────────────────────────────────────────────

/** State for folder import flow: maps telegramId → rubric name to import into. */
const folderImportStates = new Map<number, { rubricName: string }>();

/** Maps telegramId → dbUserId when user has own MTProto session for folder import. */
const folderImportClients = new Map<number, number>();

/** Handle "📂 Импорт из папки" keyboard button. */
export async function handleFolderImportButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDigestConfigured()) {
    await ctx.reply("Telegram Parser не настроен.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  // Determine which client to use: user's own or admin's
  const userHasSession = await hasActiveSession(dbUser.id);
  const adminReady = await isDigestReady();

  if (!userHasSession && !adminReady) {
    await ctx.reply(
      "Для импорта каналов из ваших папок привяжите Telegram-аккаунт.\n\n" +
      "Нажмите «🔑 Привязать Telegram»."
    );
    return;
  }

  const statusMsg = await ctx.reply("Загружаю папки Telegram...");

  try {
    let userClient: import("telegram").TelegramClient | undefined;
    if (userHasSession) {
      try {
        userClient = await getClientForUser(dbUser.id);
      } catch (err) {
        log.warn(`Failed to get user client for ${dbUser.id}, falling back to admin:`, err);
      }
    }

    const folders = await getUserDialogFolders(userClient);
    if (folders.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsg.message_id, undefined,
        "У вас нет папок в Telegram. Создайте папку с каналами в настройках Telegram."
      );
      return;
    }

    // Store whether we're using user client for subsequent callbacks
    if (userClient) {
      folderImportClients.set(telegramId, dbUser.id);
    } else {
      folderImportClients.delete(telegramId);
    }

    const buttons = folders.map((f) => [
      Markup.button.callback(`📂 ${f.title}`, `digest_folder:${f.id}`),
    ]);

    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsg.message_id, undefined,
      `Выберите папку для импорта каналов${userClient ? " (ваш аккаунт)" : ""}:`,
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

/** Resolve the user's MTProto client if they have a session, otherwise undefined. */
async function resolveUserClient(telegramId: number): Promise<import("telegram").TelegramClient | undefined> {
  const dbUserId = folderImportClients.get(telegramId);
  if (!dbUserId) return undefined;
  try {
    return await getClientForUser(dbUserId);
  } catch (err) {
    log.warn(`Failed to get user client for folder import:`, err);
    return undefined;
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
    const userClient = await resolveUserClient(telegramId);
    const channels = await getChannelsFromFolder(folderId, userClient);
    if (channels.length === 0) {
      await ctx.editMessageText(
        "В этой папке нет публичных каналов (с @username).\n" +
        "Приватные каналы пока не поддерживаются."
      );
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
    const userClient = await resolveUserClient(telegramId);
    const channels = await getChannelsFromFolder(folderId, userClient);
    let added = 0;
    let skipped = 0;

    for (const username of channels) {
      try {
        await addChannel(rubricId, username);
        added++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to add channel @${username} to rubric ${rubricId}: ${msg}`);
        skipped++;
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

