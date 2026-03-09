import type { Context } from "telegraf";
import { hasToken, getAuthUrl } from "../calendar/auth.js";
import { Markup } from "telegraf";

export async function handleStatus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }

  const linked = await hasToken(String(userId));

  if (linked) {
    await ctx.replyWithMarkdown(
      "✅ *Календарь привязан*\n\n" +
        "Вы можете создавать и отменять встречи текстом или голосом.\n" +
        "Используйте /help для списка команд."
    );
  } else {
    let url: string | null = null;
    try {
      url = getAuthUrl(String(userId));
    } catch {
      // OAUTH_REDIRECT_URI not set
    }

    const text =
      "❌ *Календарь не привязан*\n\n" +
      "Привяжите Google Calendar, чтобы создавать и просматривать встречи.";

    if (url) {
      await ctx.replyWithMarkdown(text, {
        ...Markup.inlineKeyboard([
          [Markup.button.url("Войти через Google", url)],
        ]),
      });
    } else {
      await ctx.replyWithMarkdown(
        text + "\n\nОбратитесь к администратору — OAuth не настроен."
      );
    }
  }
}
