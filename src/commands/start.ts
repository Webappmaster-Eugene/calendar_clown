import type { Context } from "telegraf";

const HELP_TEXT = `
📅 *Бот Google Calendar*

Команды:
/new _текст_ — создать встречу из фразы (например: Встреча завтра в 15:00)
/today — встречи на сегодня
/week — встречи на эту неделю
/help — эта справка
`;

export async function handleStart(ctx: Context) {
  await ctx.replyWithMarkdown(
    `Привет! Я помогу управлять встречами в Google Calendar.\n${HELP_TEXT}`
  );
}

export async function handleHelp(ctx: Context) {
  await ctx.replyWithMarkdown(HELP_TEXT);
}
