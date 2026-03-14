import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { isTranscribeAvailable } from "../transcribe/queue.js";

const DB_UNAVAILABLE_MSG =
  "Режим транскрибатора недоступен (нет подключения к базе данных).";

const QUEUE_UNAVAILABLE_MSG =
  "Режим транскрибатора недоступен (очередь не инициализирована). Проверьте REDIS_URL.";

const TRANSCRIBE_KEYBOARD = Markup.keyboard([
  ["📅 Календарь", "💰 Расходы"],
]).resize();

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

  await ctx.reply(
    "🎙 *Режим транскрибатора активирован*\n\n" +
    "Отправьте или перешлите голосовое сообщение — я расшифрую его в текст.\n\n" +
    "Можно отправлять несколько голосовых подряд — они встанут в очередь и будут обработаны по порядку.\n\n" +
    "Для переключения режима используйте кнопки ниже или команды /calendar, /expenses.",
    { parse_mode: "Markdown", ...TRANSCRIBE_KEYBOARD }
  );
}
