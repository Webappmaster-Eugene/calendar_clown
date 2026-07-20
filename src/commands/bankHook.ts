import { Markup, type Context } from "telegraf";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  getOrCreateWebhookSecret,
  regenerateWebhookSecret,
} from "../expenses/bankPush/repository.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("bankhook");

export function buildWebhookUrl(secret: string): string {
  const redirect = process.env.OAUTH_REDIRECT_URI?.trim();
  const origin = redirect ? new URL(redirect).origin : "";
  return `${origin}/webhook/bank/${secret}`;
}

const PACKAGE_NAME = "com.idamob.tinkoff.android";

function buildMessage(url: string): string {
  return (
    "🏦 *Автозапись трат из Т-Банка*\n\n" +
    "Ваш персональный адрес для пересылки пуш-уведомлений:\n" +
    `\`${url}\`\n\n` +
    "*Как настроить (Android):*\n" +
    "1. Установите *MacroDroid* (или Tasker).\n" +
    "2. Разрешите приложению доступ к уведомлениям.\n" +
    "3. Триггер: *Уведомление получено* → приложение «Т‑Банк» " +
    `(пакет \`${PACKAGE_NAME}\`).\n` +
    "4. Действие: *HTTP‑запрос (POST)* на адрес выше, тело JSON:\n" +
    '`{"title":"[notification_title]","text":"[notification_text]"}`\n' +
    "5. Готово — покупки будут появляться здесь автоматически, каждую можно поправить.\n\n" +
    "⚠️ Работает только на Android. Адрес — секретный: не публикуйте его. " +
    "Если он утёк — нажмите «Перегенерировать»."
  );
}

function keyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Перегенерировать секрет", "bhregen")],
  ]);
}

export async function handleBankHookCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна, попробуйте позже.");
    return;
  }
  if (!process.env.OAUTH_REDIRECT_URI?.trim()) {
    await ctx.reply("⚠️ Вебхук недоступен: не настроен публичный адрес сервера.");
    return;
  }

  try {
    const secret = await getOrCreateWebhookSecret(telegramId);
    if (!secret) {
      await ctx.reply("⚠️ Не удалось создать адрес. Попробуйте позже.");
      return;
    }
    await ctx.replyWithMarkdown(buildMessage(buildWebhookUrl(secret)), keyboard());
    logAction(null, telegramId, "bankhook_show", {});
  } catch (err) {
    log.error("bankhook command error:", err);
    await ctx.reply("❌ Ошибка при получении адреса вебхука.");
  }
}

export async function handleBankHookRegenerate(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }
  try {
    const secret = await regenerateWebhookSecret(telegramId);
    if (!secret) {
      await ctx.answerCbQuery("Не удалось обновить");
      return;
    }
    await ctx.editMessageText(buildMessage(buildWebhookUrl(secret)), {
      parse_mode: "Markdown",
      ...keyboard(),
    });
    await ctx.answerCbQuery("Секрет обновлён, старый адрес больше не работает");
    logAction(null, telegramId, "bankhook_regenerate", {});
  } catch (err) {
    log.error("bankhook regenerate error:", err);
    await ctx.answerCbQuery("Ошибка");
  }
}
