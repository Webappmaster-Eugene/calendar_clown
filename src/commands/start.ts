import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken } from "../calendar/auth.js";

const HELP_TEXT = `
📅 *Бот Google Calendar*

Команды:
/auth _код_ — привязать календарь (код после авторизации по ссылке из /start)
/new _текст_ — создать встречу из фразы (например: Встреча завтра в 15:00)
/today — встречи на сегодня
/week — встречи на эту неделю
/help — эта справка
/send _@user текст_ — отправить сообщение пользователю от имени бота (только доверенные)
`;

export async function handleStart(ctx: Context) {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.replyWithMarkdown(`Привет! Я помогу управлять встречами в Google Calendar.\n${HELP_TEXT}`);
    return;
  }
  const linked = await hasToken(String(userId));
  if (linked) {
    await ctx.replyWithMarkdown(
      `Привет! Календарь уже привязан. Я помогу управлять встречами.\n${HELP_TEXT}`
    );
    return;
  }
  const url = getAuthUrl(String(userId));
  await ctx.replyWithMarkdown(
    `Привет! Чтобы пользоваться календарём, привяжите свой Google Calendar.\n\n` +
      `1. Нажмите кнопку ниже и войдите в Google.\n\n` +
      `2. Скопируйте код из браузера и отправьте его боту командой:\n` +
      `\`/auth ВСТАВЬТЕ_КОД_СЮДА\``,
    {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.url("Войти через Google", url)]]),
    }
  );
}

export async function handleHelp(ctx: Context) {
  await ctx.replyWithMarkdown(HELP_TEXT);
}
