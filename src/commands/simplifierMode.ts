/**
 * Simplifier mode command handler.
 * Accumulates text/voice messages, then simplifies via AI on demand.
 * Results are delivered in the order requests were submitted (ordered delivery).
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { splitMessage } from "../utils/telegram.js";
import { createLogger } from "../utils/logger.js";
import { simplifyText } from "../simplifier/simplify.js";
import {
  createSimplification,
  markSimplificationCompleted,
  markSimplificationFailed,
  markSimplificationProcessing,
  getSimplificationsPaginated,
  countSimplifications,
  getSimplificationById,
  deleteSimplification,
} from "../simplifier/repository.js";
import {
  deliverSimplificationsInOrder,
  getSimplifierDeliveryBot,
} from "../simplifier/deliveryQueue.js";
import { MAX_SIMPLIFIER_INPUT_LENGTH } from "../constants.js";
import { DB_UNAVAILABLE_MSG } from "../constants.js";

const log = createLogger("simplifier-mode");

const HISTORY_PAGE_SIZE = 5;
const PREVIEW_LENGTH = 100;

// ─── In-memory buffer for message accumulation ─────────────────

interface PendingBuffer {
  texts: string[];
  inputTypes: Set<"text" | "voice">;
  chatId: number;
}

const pendingMessages = new Map<number, PendingBuffer>();

/** Clear the pending buffer for a user. */
function clearBuffer(telegramId: number): void {
  pendingMessages.delete(telegramId);
}

/** Get buffer count for a user. */
function getBufferCount(telegramId: number): number {
  return pendingMessages.get(telegramId)?.texts.length ?? 0;
}

// ─── Keyboard ──────────────────────────────────────────────────

function getSimplifierKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["🧹 Упростить", "🗑 Очистить буфер"],
    ["📋 История"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ──────────────────────────────────────────────

export async function handleSimplifierCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId),
  );

  // Clear any pending buffer on mode activation
  clearBuffer(telegramId);

  await setUserMode(telegramId, "simplifier");
  await setModeMenuCommands(ctx, "simplifier");

  const isAdmin = isBootstrapAdmin(telegramId);

  await ctx.reply(
    "🧹 *Режим Упрощатель мыслей активирован*\n\n" +
    "Отправляйте текстовые или голосовые сообщения — они будут накапливаться в буфере.\n\n" +
    "Когда закончите, нажмите *«🧹 Упростить»* — я объединю всё и очищу текст от мусора, повторений и слов-паразитов.\n\n" +
    "Результат сохранится в историю.",
    { parse_mode: "Markdown", ...getSimplifierKeyboard(isAdmin) },
  );
}

// ─── Text handler ──────────────────────────────────────────────

export async function handleSimplifierText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const text = ctx.message.text.trim();
  if (!text) return false;

  const chatId = ctx.chat?.id;
  if (chatId == null) return false;

  let buffer = pendingMessages.get(telegramId);
  if (!buffer) {
    buffer = { texts: [], inputTypes: new Set(), chatId };
    pendingMessages.set(telegramId, buffer);
  }

  buffer.texts.push(text);
  buffer.inputTypes.add("text");

  const count = buffer.texts.length;
  await ctx.reply(
    `📝 Сообщение добавлено (всего: ${count}). Нажмите «🧹 Упростить» для обработки.`,
  );

  return true;
}

// ─── Voice handler ─────────────────────────────────────────────

export async function handleSimplifierVoice(
  ctx: Context,
  transcript: string,
  statusMessageId: number,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const chatId = ctx.chat?.id;
  if (chatId == null) return;

  let buffer = pendingMessages.get(telegramId);
  if (!buffer) {
    buffer = { texts: [], inputTypes: new Set(), chatId };
    pendingMessages.set(telegramId, buffer);
  }

  buffer.texts.push(transcript);
  buffer.inputTypes.add("voice");

  const count = buffer.texts.length;

  try {
    await ctx.telegram.editMessageText(
      chatId,
      statusMessageId,
      undefined,
      `🎙 Голосовое расшифровано и добавлено в буфер (всего: ${count}). Нажмите «🧹 Упростить» для обработки.`,
    );
  } catch {
    await ctx.reply(
      `🎙 Голосовое расшифровано и добавлено в буфер (всего: ${count}). Нажмите «🧹 Упростить» для обработки.`,
    );
  }
}

// ─── Simplify button ───────────────────────────────────────────

export async function handleSimplifyButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const buffer = pendingMessages.get(telegramId);
  if (!buffer || buffer.texts.length === 0) {
    await ctx.reply("Буфер пуст. Отправьте текстовые или голосовые сообщения, затем нажмите «🧹 Упростить».");
    return;
  }

  const combinedText = buffer.texts.join("\n\n");

  if (combinedText.length > MAX_SIMPLIFIER_INPUT_LENGTH) {
    await ctx.reply(
      `⚠️ Суммарный объём текста (${combinedText.length} символов) превышает лимит (${MAX_SIMPLIFIER_INPUT_LENGTH}). ` +
      "Очистите буфер и отправьте меньше сообщений.",
    );
    return;
  }

  // Determine input type
  const inputTypes = buffer.inputTypes;
  let inputType: string;
  if (inputTypes.has("text") && inputTypes.has("voice")) {
    inputType = "mixed";
  } else if (inputTypes.has("voice")) {
    inputType = "voice";
  } else {
    inputType = "text";
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  // Use message_id of the "Simplify" button press as sequence number
  const sequenceNumber = ctx.message!.message_id;
  const chatId = ctx.chat!.id;

  // Send status message BEFORE creating DB record (need its message_id)
  const statusMsg = await ctx.reply("⏳ Упрощаю текст...");

  // Create DB record with sequence tracking
  let record;
  try {
    record = await createSimplification(
      dbUser.id, inputType, combinedText,
      sequenceNumber, chatId, statusMsg.message_id,
    );
  } catch (err) {
    log.error("Error creating simplification record:", err);
    try {
      await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
    } catch { /* ignore */ }
    await ctx.reply("Ошибка при сохранении. Попробуйте ещё раз.");
    return;
  }

  // Clear buffer immediately — text is persisted in DB
  clearBuffer(telegramId);

  // Fire-and-forget: process async, trigger ordered delivery when done
  void processSimplificationAsync(dbUser.id, record.id, combinedText);
}

/** Process simplification asynchronously and trigger ordered delivery. */
async function processSimplificationAsync(
  userId: number,
  recordId: number,
  text: string,
): Promise<void> {
  try {
    await markSimplificationProcessing(recordId);
    const { result, model } = await simplifyText(text);
    await markSimplificationCompleted(recordId, result, model);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка";
    log.error(`Simplification ${recordId} failed:`, err);
    try {
      await markSimplificationFailed(recordId, errorMsg);
    } catch (dbErr) {
      log.error("Error marking simplification as failed:", dbErr);
    }
  }
  // Always trigger delivery — whether success or failure
  deliverSimplificationsInOrder(getSimplifierDeliveryBot(), userId);
}

// ─── Clear buffer button ───────────────────────────────────────

export async function handleSimplifierClearButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const count = getBufferCount(telegramId);
  clearBuffer(telegramId);

  if (count === 0) {
    await ctx.reply("Буфер и так пуст.");
  } else {
    await ctx.reply(`✅ Буфер очищен (было сообщений: ${count}).`);
  }
}

// ─── History ───────────────────────────────────────────────────

export async function handleSimplifierHistoryButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  await sendHistoryPage(ctx, dbUser.id, 0);
}

export async function handleSimplifierHistoryCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;

  const match = data.match(/^simp_hist:(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery();
    return;
  }

  const offset = parseInt(match[1], 10);
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  try {
    await sendHistoryPage(ctx, dbUser.id, offset, true);
    await ctx.answerCbQuery();
  } catch (err) {
    log.error("Error in simplifier history pagination:", err);
    await ctx.answerCbQuery("Ошибка загрузки.");
  }
}

async function sendHistoryPage(
  ctx: Context,
  userId: number,
  offset: number,
  editExisting: boolean = false,
): Promise<void> {
  try {
    const total = await countSimplifications(userId);
    if (total === 0) {
      const msg = "История упрощений пуста.";
      if (editExisting) {
        await ctx.editMessageText(msg);
      } else {
        await ctx.reply(msg);
      }
      return;
    }

    const items = await getSimplificationsPaginated(userId, HISTORY_PAGE_SIZE, offset);

    const lines = items.map((s, i) => {
      const num = offset + i + 1;
      const date = s.createdAt.toLocaleDateString("ru-RU", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      const typeIcon = s.inputType === "voice" ? "🎙" : s.inputType === "mixed" ? "🎙📝" : "📝";
      const preview = s.simplifiedText
        ? s.simplifiedText.length > PREVIEW_LENGTH
          ? s.simplifiedText.slice(0, PREVIEW_LENGTH) + "..."
          : s.simplifiedText
        : s.status === "failed"
          ? `❌ ${s.errorMessage ?? "Ошибка"}`
          : "(обработка...)";
      return `*${num}.* ${typeIcon} ${date}\n${preview}`;
    });

    const totalPages = Math.ceil(total / HISTORY_PAGE_SIZE);
    const currentPage = Math.floor(offset / HISTORY_PAGE_SIZE) + 1;

    const text = `🧹 *Упрощения (${currentPage}/${totalPages}, всего: ${total}):*\n\n${lines.join("\n\n")}`;

    // Inline buttons per item
    const inlineRows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
    for (const s of items) {
      const idx = items.indexOf(s);
      const num = offset + idx + 1;
      const row: Array<ReturnType<typeof Markup.button.callback>> = [];
      if (s.simplifiedText && s.simplifiedText.length > PREVIEW_LENGTH) {
        row.push(
          Markup.button.callback(
            `📖 #${num}`,
            `simp_full:${s.id}`,
          ),
        );
      }
      row.push(Markup.button.callback(`🗑 #${num}`, `simp_del:${s.id}`));
      inlineRows.push(row);
    }

    // Pagination
    const paginationRow: Array<ReturnType<typeof Markup.button.callback>> = [];
    if (offset > 0) {
      paginationRow.push(Markup.button.callback("⬅️ Назад", `simp_hist:${offset - HISTORY_PAGE_SIZE}`));
    }
    if (offset + HISTORY_PAGE_SIZE < total) {
      paginationRow.push(Markup.button.callback("Вперёд ➡️", `simp_hist:${offset + HISTORY_PAGE_SIZE}`));
    }
    if (paginationRow.length > 0) {
      inlineRows.push(paginationRow);
    }

    const keyboard = inlineRows.length > 0 ? Markup.inlineKeyboard(inlineRows) : undefined;

    if (editExisting) {
      await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
    }
  } catch (err) {
    log.error("Error fetching simplifier history:", err);
    const msg = "Ошибка при получении истории.";
    if (editExisting) {
      await ctx.editMessageText(msg);
    } else {
      await ctx.reply(msg);
    }
  }
}

// ─── Full text callback ────────────────────────────────────────

export async function handleSimplifierFullCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;

  const match = data.match(/^simp_full:(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery();
    return;
  }

  const id = parseInt(match[1], 10);
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  try {
    const item = await getSimplificationById(id, dbUser.id);
    if (!item || !item.simplifiedText) {
      await ctx.answerCbQuery("Запись не найдена.");
      return;
    }

    await ctx.answerCbQuery();

    const header = "🧹 *Результат упрощения:*\n\n";
    const chunks = splitMessage(header + item.simplifiedText, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }

    // Also show original for reference
    const origHeader = "📄 *Оригинал:*\n\n";
    const origChunks = splitMessage(origHeader + item.originalText, 4096);
    for (const chunk of origChunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }
  } catch (err) {
    log.error("Error fetching full simplification:", err);
    await ctx.answerCbQuery("Ошибка загрузки.");
  }
}

// ─── Delete callback ───────────────────────────────────────────

export async function handleSimplifierDeleteCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  // simp_del:<id> — show confirmation
  const delMatch = data.match(/^simp_del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await ctx.editMessageText(
      `⚠️ Удалить упрощение #${id}?\n\nЭто действие необратимо.`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Да, удалить", `simp_del_yes:${id}`)],
          [Markup.button.callback("❌ Отмена", "simp_hist:0")],
        ]),
      },
    );
    await ctx.answerCbQuery();
    return;
  }

  // simp_del_yes:<id> — confirm delete
  const delYesMatch = data.match(/^simp_del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    try {
      const deleted = await deleteSimplification(id, dbUser.id);
      if (deleted) {
        await ctx.editMessageText(`✅ Упрощение #${id} удалено.`);
      } else {
        await ctx.editMessageText("❌ Запись не найдена или уже удалена.");
      }
    } catch (err) {
      log.error("Error deleting simplification:", err);
      await ctx.editMessageText("❌ Ошибка при удалении.");
    }
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();
}
