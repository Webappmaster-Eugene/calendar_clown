import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isTranscribeAvailable, clearUserJobs } from "../transcribe/queue.js";
import {
  getRecentTranscriptionsPaginated,
  countCompletedTranscriptions,
  markUserPendingAsFailed,
} from "../transcribe/repository.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";

const DB_UNAVAILABLE_MSG =
  "Режим транскрибатора недоступен (нет подключения к базе данных).";

const QUEUE_UNAVAILABLE_MSG =
  "Режим транскрибатора недоступен (очередь не инициализирована). Проверьте REDIS_URL.";

const HISTORY_PAGE_SIZE = 5;

function getTranscribeKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📋 История", "🗑 Очистить очередь"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

export async function handleTranscribeCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  if (!isTranscribeAvailable()) {
    await ctx.reply(QUEUE_UNAVAILABLE_MSG);
    return;
  }

  // Ensure user exists in DB before switching mode
  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "transcribe");
  await setModeMenuCommands(ctx, "transcribe");

  await ctx.reply(
    "🎙 *Режим транскрибатора активирован*\n\n" +
    "Отправьте или перешлите голосовое сообщение — я расшифрую его в текст.\n\n" +
    "Можно отправлять несколько голосовых подряд — они встанут в очередь и будут обработаны по порядку.\n\n" +
    "Для переключения режима используйте кнопки ниже или команды /calendar, /expenses.",
    { parse_mode: "Markdown", ...getTranscribeKeyboard(isBootstrapAdmin(telegramId)) }
  );
}

const log = createLogger("transcribe-mode");

/** Format duration in seconds to "M:SS" string. */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Handle "🗑 Очистить очередь" keyboard button. */
export async function handleClearQueueButton(ctx: Context): Promise<void> {
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

  try {
    const chatId = ctx.chat?.id;
    let queueCleared = 0;
    if (chatId != null) {
      queueCleared = await clearUserJobs(chatId);
    }
    const dbCleared = await markUserPendingAsFailed(dbUser.id, "Очищено пользователем");

    if (queueCleared === 0 && dbCleared === 0) {
      await ctx.reply("Очередь пуста — нечего очищать.");
    } else {
      await ctx.reply(
        `✅ Очередь очищена.\n` +
        `Удалено из очереди: ${queueCleared}\n` +
        `Отменено в БД: ${dbCleared}`
      );
    }
  } catch (err) {
    log.error("Error clearing queue:", err);
    await ctx.reply("Ошибка при очистке очереди.");
  }
}

/** Handle "📋 История" keyboard button — show paginated transcription history. */
export async function handleTranscribeHistoryButton(ctx: Context): Promise<void> {
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

/** Handle pagination callback for transcription history. */
export async function handleTranscribeHistoryCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;

  const match = data.match(/^tr_hist:(\d+)$/);
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
    log.error("Error in history pagination:", err);
    await ctx.answerCbQuery("Ошибка загрузки.");
  }
}

/** Send a page of transcription history. */
async function sendHistoryPage(
  ctx: Context,
  userId: number,
  offset: number,
  editExisting: boolean = false
): Promise<void> {
  try {
    const total = await countCompletedTranscriptions(userId);
    if (total === 0) {
      const msg = "История транскрипций пуста.";
      if (editExisting) {
        await ctx.editMessageText(msg);
      } else {
        await ctx.reply(msg);
      }
      return;
    }

    const transcriptions = await getRecentTranscriptionsPaginated(userId, HISTORY_PAGE_SIZE, offset);

    const lines = transcriptions.map((t, i) => {
      const num = offset + i + 1;
      const date = t.transcribedAt
        ? t.transcribedAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "—";
      const duration = formatDuration(t.durationSeconds);
      const from = t.forwardedFromName ? ` (от: ${t.forwardedFromName})` : "";
      const preview = t.transcript
        ? t.transcript.length > 100
          ? t.transcript.slice(0, 100) + "..."
          : t.transcript
        : "(нет текста)";
      return `*${num}.* [${duration}] ${date}${from}\n${preview}`;
    });

    const totalPages = Math.ceil(total / HISTORY_PAGE_SIZE);
    const currentPage = Math.floor(offset / HISTORY_PAGE_SIZE) + 1;

    const text = `📋 *Транскрипции (${currentPage}/${totalPages}, всего: ${total}):*\n\n${lines.join("\n\n")}`;

    // Build pagination buttons
    const buttons: Array<ReturnType<typeof Markup.button.callback>> = [];
    if (offset > 0) {
      buttons.push(Markup.button.callback("⬅️ Назад", `tr_hist:${offset - HISTORY_PAGE_SIZE}`));
    }
    if (offset + HISTORY_PAGE_SIZE < total) {
      buttons.push(Markup.button.callback("Вперёд ➡️", `tr_hist:${offset + HISTORY_PAGE_SIZE}`));
    }

    const keyboard = buttons.length > 0 ? Markup.inlineKeyboard([buttons]) : undefined;

    if (editExisting) {
      await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
    }
  } catch (err) {
    log.error("Error fetching transcription history:", err);
    const msg = "Ошибка при получении истории.";
    if (editExisting) {
      await ctx.editMessageText(msg);
    } else {
      await ctx.reply(msg);
    }
  }
}
