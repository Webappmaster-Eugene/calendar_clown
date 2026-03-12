import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken } from "../calendar/auth.js";

const HELP_TEXT = `
*Бот Google Calendar + Учёт расходов*

📅 *Календарь:*
/auth _код_ — привязать календарь
/status — проверить привязку календаря
/new _текст_ — создать встречу из фразы
/today — встречи на сегодня
/week — встречи на эту неделю

💰 *Расходы:*
/expenses — режим учёта расходов
/calendar — вернуться к календарю

🎤 *Голосовые команды:*
• Создать встречу: «Встреча завтра в 15:00»
• Отменить встречу: «Отмени встречу с Романом»
• Записать трату: «Аптека геморрой пять тысяч»

/help — эта справка
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
  let url: string;
  try {
    url = getAuthUrl(String(userId));
  } catch (err) {
    await ctx.reply(
      "Привязка календаря недоступна: не задан OAUTH_REDIRECT_URI. Обратитесь к администратору."
    );
    return;
  }
  await ctx.replyWithMarkdown(
    `Привет! Чтобы пользоваться календарём, привяжите свой Google Calendar.\n\n` +
      `Нажмите кнопку ниже и войдите в Google — календарь привяжется автоматически. Закройте страницу и вернитесь сюда.\n\n` +
      `Если что-то пойдёт не так, можно вручную: скопируйте код из браузера и отправьте \`/auth КОД\`.`,
    {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.url("Войти через Google", url)]]),
    }
  );
}

export async function handleHelp(ctx: Context) {
  await ctx.replyWithMarkdown(HELP_TEXT);
}
