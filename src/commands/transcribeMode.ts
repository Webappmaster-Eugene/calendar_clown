import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser, getUserByTelegramId } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isTranscribeAvailable } from "../transcribe/queue.js";
import { getRecentTranscriptions } from "../transcribe/repository.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";

const DB_UNAVAILABLE_MSG =
  "Режим транскрибатора недоступен (нет подключения к базе данных).";

const QUEUE_UNAVAILABLE_MSG =
  "Режим транскрибатора недоступен (очередь не инициализирована). Проверьте REDIS_URL.";

function getTranscribeKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📋 История"],
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

/** Handle "📋 История" keyboard button — show recent transcriptions. */
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

  try {
    const transcriptions = await getRecentTranscriptions(dbUser.id, 10);
    if (transcriptions.length === 0) {
      await ctx.reply("История транскрипций пуста.");
      return;
    }

    const lines = transcriptions.map((t, i) => {
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
      return `*${i + 1}.* [${duration}] ${date}${from}\n${preview}`;
    });

    const text = `📋 *Последние транскрипции:*\n\n${lines.join("\n\n")}`;

    // Split if too long
    if (text.length > 4000) {
      const half = Math.ceil(lines.length / 2);
      await ctx.reply(`📋 *Транскрипции (1/2):*\n\n${lines.slice(0, half).join("\n\n")}`, { parse_mode: "Markdown" });
      await ctx.reply(`📋 *Транскрипции (2/2):*\n\n${lines.slice(half).join("\n\n")}`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown" });
    }
  } catch (err) {
    log.error("Error fetching transcription history:", err);
    await ctx.reply("Ошибка при получении истории.");
  }
}
