import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken } from "../calendar/auth.js";
import { isBootstrapAdmin, getUserMenuContext } from "../middleware/auth.js";
import { getModeKeyboard } from "./expenseMode.js";

const HELP_TEXT = `
*Многофункциональный бот-ассистент*

📅 *Календарь:*
/auth — привязать календарь
/status — проверить привязку
/new _текст_ — создать встречу
/cancel _запрос_ — отменить встречу
/today — встречи на сегодня
/week — встречи на неделю

💰 *Расходы (требуется трайб):*
/expenses — режим учёта расходов

🎙️ *Транскрибация:*
/transcribe — расшифровка голосовых в текст

🧹 *Упрощатель:*
/simplifier — упрощение текста от мусора и повторений

🧙 *База знаний:*
/gandalf — каталог записей с категориями

📰 *Дайджест (требуется трайб):*
/digest — дайджест телеграм-каналов

🎂 *Даты (требуется трайб):*
/dates — дни рождения, праздники, памятные даты

🧠 *Нейро:*
/neuro — AI-чат с нейросетью

🎁 *Вишлист (требуется трайб):*
/wishlist — списки желаний и подарков

🎯 *Цели:*
/goals — постановка и отслеживание целей

⏰ *Напоминания:*
/reminders — гибкие напоминания по расписанию

🔍 *OSINT (требуется трайб):*
/osint — поиск информации

📋 *Резюме (требуется трайб):*
/summarizer — учёт достижений на работе

✍️ *Блогер (требуется трайб):*
/blogger — управление каналами и постами

✅ *Задачи (требуется трайб):*
/tasks — трекер задач с дедлайнами

🔀 *Переключение:*
/mode — выбор режима работы

📢 *Рассылка (только админ):*
/broadcast — отправка сообщений в трайб

⚙️ *Админка (только админ):*
/admin — управление пользователями и данными
/stats — статистика бота

🎤 *Голосовые команды:*
• Создать встречу: «Встреча завтра в 15:00»
• Отменить встречу: «Отмени встречу с Романом»
• Записать трату: «Аптека 5000»
• Создать напоминание: «Напомни проверить почту в 10»

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

  const menuCtx = await getUserMenuContext(userId);

  // Pending user — show application status
  if (menuCtx && menuCtx.status === "pending") {
    await ctx.reply(
      "⏳ *Ваша заявка на рассмотрении*\n\n" +
      "Администратор ещё не одобрил вашу заявку. Пожалуйста, ожидайте.\n\n" +
      `Ваш Telegram ID: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const linked = await hasToken(String(userId));

  let greeting: string;
  if (linked) {
    greeting = "👋 *Привет! Календарь привязан.*";
  } else {
    greeting = "👋 *Привет!* Привяжите календарь: /auth";
  }

  greeting += "\n\nВыберите режим работы кнопками ниже.\n" +
    "Подробнее о каждом: /help\n" +
    "Сменить режим: /mode или 🏠";

  // Add user status info
  if (menuCtx) {
    const roleLabel = menuCtx.role === "admin" ? "Админ" : "Пользователь";
    const statusLabel = menuCtx.status === "approved" ? "Активен" : menuCtx.status;
    const tribeLabel = menuCtx.tribeName ?? "—";
    greeting += `\n\n👤 ${roleLabel} | ${statusLabel} | Трайб: ${tribeLabel}`;
  }

  await ctx.reply(greeting, {
    parse_mode: "Markdown",
    ...getModeKeyboard(isAdmin, menuCtx),
  });
}

export async function handleHelp(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithMarkdown(HELP_TEXT);
  } catch {
    await ctx.reply(HELP_TEXT.replace(/[*_`\[\]\\]/g, ""));
  }
}
