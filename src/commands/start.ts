import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getAuthUrl, hasToken } from "../calendar/auth.js";
import { setMode } from "../chatMode.js";
import * as sessions from "../openclaw/sessions.js";
import { isAdmin } from "../admin.js";

export const MENU_BTN_CALENDAR = "Календарь";
export const MENU_BTN_OPENCLAW = "OpenClaw";
export const MENU_BTN_SEND = "Отправить сообщение";

function hasOpenClaw(): boolean {
  return Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim());
}

export function getModeKeyboard() {
  return Markup.keyboard([
    [MENU_BTN_CALENDAR, MENU_BTN_OPENCLAW],
    [MENU_BTN_SEND],
  ]).resize();
}

/** Handle "Календарь" / "OpenClaw" button press; returns true if text was a menu button. */
export async function handleMenuSwitch(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id != null ? String(ctx.chat.id) : null;
  if (!chatId || !("text" in ctx.message) || typeof ctx.message.text !== "string") return false;
  const text = ctx.message.text.trim();
  if (text === MENU_BTN_CALENDAR) {
    setMode(chatId, "calendar");
    sessions.clear(chatId);
    await ctx.reply(
      "Режим: Календарь. Голосовые и /new — для встреч.",
      getModeKeyboard()
    );
    return true;
  }
  if (text === MENU_BTN_OPENCLAW) {
    const userId = ctx.from?.id ?? ctx.chat?.id;
    if (userId == null) return true;
    const linked = await hasToken(String(userId));
    if (!linked) {
      await ctx.reply(
        "Режим OpenClaw доступен только после привязки календаря. Отправьте /start и войдите через Google.",
        getModeKeyboard()
      );
      return true;
    }
    setMode(chatId, "openclaw");
    sessions.getOrCreate(chatId);
    await ctx.reply(
      "Режим OpenClaw. Пишите или отправляйте голосовые — задачи уйдут агенту. /stop — выйти.",
      getModeKeyboard()
    );
    return true;
  }
  if (text === MENU_BTN_SEND) {
    if (!isAdmin(ctx)) {
      await ctx.reply(
        "Режим доступен только доверенным пользователям.",
        getModeKeyboard()
      );
      return true;
    }
    setMode(chatId, "send_message");
    await ctx.reply(
      "Режим: Отправка сообщения. Напишите в одну строку: @username Текст сообщения (получатель должен уже писать боту).",
      getModeKeyboard()
    );
    return true;
  }
  return false;
}

const HELP_TEXT = `
📅 *Бот Google Calendar*

Команды:
/auth _код_ — привязать календарь (код после авторизации по ссылке из /start)
/new _текст_ — создать встречу из фразы (например: Встреча завтра в 15:00)
/today — встречи на сегодня
/week — встречи на эту неделю
/help — эта справка
/send _@user текст_ — отправить сообщение пользователю от имени бота (только доверенные)
/openclaw _[текст]_ — чат с OpenClaw (если настроен); без текста — режим диалога
/stop — выйти из режима чата OpenClaw
/menu — показать меню выбора режима (Календарь / OpenClaw / Отправить сообщение)
`;

/** One-line hint with user Telegram ID for verifying ADMIN_USER_IDS (voice send / /send). */
function userIdHint(ctx: Context): string {
  const id = ctx.from?.id;
  if (id == null) return "";
  const trusted = isAdmin(ctx);
  return `\n\nВаш Telegram ID: \`${id}\`${trusted ? " (доверенный)." : " — для отправки сообщений голосом добавьте этот ID в ADMIN_USER_IDS."}`;
}

export async function handleStart(ctx: Context) {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.replyWithMarkdown(`Привет! Я помогу управлять встречами в Google Calendar.\n${HELP_TEXT}`);
    return;
  }
  const linked = await hasToken(String(userId));
  if (linked) {
    await ctx.replyWithMarkdown(
      `Привет! Календарь уже привязан. Я помогу управлять встречами.\n${HELP_TEXT}${userIdHint(ctx)}`
    );
    if (hasOpenClaw()) {
      await ctx.reply(
        "Выберите режим: Календарь — встречи, OpenClaw — задачи агенту, Отправить сообщение — только для доверенных.",
        getModeKeyboard()
      );
    }
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
      `Если что-то пойдёт не так, можно вручную: скопируйте код из браузера и отправьте \`/auth КОД\`.${userIdHint(ctx)}`,
    {
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.url("Войти через Google", url)]]),
    }
  );
}

export async function handleHelp(ctx: Context) {
  await ctx.replyWithMarkdown(HELP_TEXT + userIdHint(ctx));
}

export async function handleMenu(ctx: Context) {
  if (!hasOpenClaw()) {
    await ctx.reply("Меню режимов доступно только при настроенном OpenClaw.");
    return;
  }
  await ctx.reply(
    "Выберите режим: Календарь — встречи, OpenClaw — задачи агенту, Отправить сообщение — только для доверенных.",
    getModeKeyboard()
  );
}
