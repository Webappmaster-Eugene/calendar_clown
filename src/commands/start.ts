import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken } from "../calendar/auth.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { getModeKeyboard } from "./expenseMode.js";

const HELP_TEXT = `
*Бот Google Calendar + Учёт расходов + Транскрибатор*

📅 *Календарь:*
/auth — привязать календарь
/status — проверить привязку
/new _текст_ — создать встречу
/cancel _запрос_ — отменить встречу
/today — встречи на сегодня
/week — встречи на неделю

💰 *Расходы:*
/expenses — режим учёта расходов
/calendar — режим календаря

🎙 *Транскрибатор:*
/transcribe — режим расшифровки голосовых
Отправьте или перешлите голосовое — бот вернёт текст

📰 *Дайджест:*
/digest — управление рубриками и каналами
/digest now — запустить дайджест сейчас

🎉 *Знаменательные даты:*
/dates — дни рождения, праздники и памятные даты

🔀 *Переключение:*
/mode — выбор режима работы

📢 *Рассылка (только админ):*
/broadcast — режим рассылки сообщений

🔧 *Администрирование:*
/admin — управление пользователями
/stats — статистика бота (только админ)

🎤 *Голосовые команды (режим календаря):*
• Создать встречу: «Встреча завтра в 15:00»
• Отменить встречу: «Отмени встречу с Романом»
• Записать трату (режим расходов): «Аптека 5000»

/help — эта справка
`;

export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const isAdmin = userId != null && isBootstrapAdmin(userId);

  if (userId == null) {
    await ctx.reply("Привет! Выберите режим работы:", {
      ...getModeKeyboard(false),
    });
    return;
  }

  const linked = await hasToken(String(userId));

  let greeting: string;
  if (linked) {
    greeting = "Привет! Календарь привязан. Выберите режим:";
  } else {
    greeting = "Привет! Привяжите календарь: /auth\nВыберите режим работы:";
  }

  await ctx.reply(greeting, {
    ...getModeKeyboard(isAdmin),
  });
}

export async function handleHelp(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithMarkdown(HELP_TEXT);
  } catch {
    await ctx.reply(HELP_TEXT.replace(/[*_`\[\]\\]/g, ""));
  }
}
