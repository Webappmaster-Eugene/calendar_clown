import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken, saveTokenFromCode } from "../calendar/auth.js";

export async function handleAuth(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }

  if (!ctx.message || !("text" in ctx.message)) return;
  const text = typeof ctx.message.text === "string"
    ? ctx.message.text.replace(/^\/auth\s*/i, "").trim()
    : "";

  if (!text) {
    // No code provided — check if already linked, otherwise show OAuth button
    const linked = await hasToken(String(userId));
    if (linked) {
      await ctx.reply("✅ Календарь уже привязан. /today — встречи на сегодня.");
      return;
    }

    try {
      const url = getAuthUrl(String(userId));
      await ctx.replyWithMarkdown(
        "Для привязки календаря нажмите кнопку ниже и авторизуйтесь в Google:",
        {
          ...Markup.inlineKeyboard([
            [Markup.button.url("🔗 Войти через Google", url)],
          ]),
        }
      );
    } catch {
      await ctx.reply("OAuth не настроен. Обратитесь к администратору.");
    }
    return;
  }

  // Code provided — exchange for token (legacy flow, kept for compatibility)
  try {
    await saveTokenFromCode(text, String(userId));
    await ctx.reply("✅ Календарь привязан. Можете создавать встречи: /new завтра в 15:00");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка авторизации";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
