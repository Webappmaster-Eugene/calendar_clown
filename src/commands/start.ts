import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken } from "../calendar/auth.js";

const HELP_TEXT = `
*Бот Google Calendar + Учёт расходов*

📅 *Календарь:*
/auth _код_ — привязать календарь
/status — проверить привязку
/new _текст_ — создать встречу
/today — встречи на сегодня
/week — встречи на неделю

💰 *Расходы:*
/expenses — режим учёта расходов
/calendar — режим календаря

🔧 *Администрирование:*
/admin — управление пользователями

🎤 *Голосовые команды:*
• Создать встречу: «Встреча завтра в 15:00»
• Отменить встречу: «Отмени встречу с Романом»
• Записать трату: «Аптека геморрой пять тысяч»

/help — эта справка
`;

export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply("Привет! Выберите режим работы:", {
      ...Markup.keyboard([
        ["📅 Календарь", "💰 Расходы"],
      ]).resize(),
    });
    return;
  }

  const linked = await hasToken(String(userId));

  let greeting: string;
  if (linked) {
    greeting = "Привет! Календарь привязан. Выберите режим:";
  } else {
    greeting = "Привет! Выберите режим работы:";
  }

  await ctx.reply(greeting, {
    ...Markup.keyboard([
      ["📅 Календарь", "💰 Расходы"],
    ]).resize(),
  });
}

export async function handleHelp(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithMarkdown(HELP_TEXT);
  } catch {
    await ctx.reply(HELP_TEXT.replace(/[*_`\[\]\\]/g, ""));
  }
}
