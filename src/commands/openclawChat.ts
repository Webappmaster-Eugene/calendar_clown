import type { Context } from "telegraf";
import { setMode } from "../chatMode.js";
import { hasToken } from "../calendar/auth.js";
import { sendChat } from "../openclaw/chat.js";
import * as sessions from "../openclaw/sessions.js";

const DEFAULT_OPENCLAW_SYSTEM_PROMPT = `You are a helpful assistant with access to tools. You can help with: web search, composing summaries, sending email (if you have the tool), and answering questions. Reply in the same language as the user. The user may send tasks by voice; you will receive the transcribed text.`;

/**
 * Map sendChat() error to a short user-facing message.
 */
export function formatOpenClawError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("OPENCLAW_GATEWAY_TOKEN") || message.includes("not set")) {
    return "OpenClaw не настроен (задайте OPENCLAW_GATEWAY_TOKEN и URL).";
  }
  if (/OpenClaw request failed: 401/.test(message) || /OpenClaw request failed: 403/.test(message)) {
    return "Ошибка авторизации OpenClaw (проверьте OAuth в OpenClaw).";
  }
  if (message.includes("abort") || message.includes("timeout") || message.includes("AbortError")) {
    return "Таймаут запроса к OpenClaw.";
  }
  if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed")) {
    return "Сервер OpenClaw недоступен (проверьте URL и что шлюз запущен).";
  }
  return "OpenClaw недоступен: " + message.slice(0, 180);
}

export function getOpenClawSystemPrompt(): string {
  const custom = process.env.OPENCLAW_SYSTEM_PROMPT?.trim();
  return custom || DEFAULT_OPENCLAW_SYSTEM_PROMPT;
}

function getChatId(ctx: Context): string | null {
  const id = ctx.chat?.id;
  return id != null ? String(id) : null;
}

export async function handleOpenClaw(ctx: Context) {
  const chatId = getChatId(ctx);
  if (!chatId) return;

  const userId = ctx.from?.id ?? ctx.chat?.id;
  if (userId != null) {
    const linked = await hasToken(String(userId));
    if (!linked) {
      await ctx.reply(
        "Режим OpenClaw доступен только после привязки календаря. Отправьте /start и войдите через Google."
      );
      return;
    }
  }

  const rawText = "text" in ctx.message ? ctx.message.text : "";
  const textAfterCommand = rawText.replace(/^\/openclaw\s*/i, "").trim();

  if (textAfterCommand) {
    setMode(chatId, "openclaw");
    sessions.getOrCreate(chatId);
    sessions.appendUser(chatId, textAfterCommand);
    await ctx.sendChatAction("typing");
    try {
      const history = sessions.getOrCreate(chatId);
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: getOpenClawSystemPrompt() },
        ...history,
      ];
      const reply = await sendChat(messages);
      sessions.appendAssistant(chatId, reply);
      await ctx.reply(reply || "—");
    } catch (err) {
      await ctx.reply(formatOpenClawError(err));
    }
    return;
  }

  setMode(chatId, "openclaw");
  sessions.getOrCreate(chatId);
  await ctx.reply(
    "Режим OpenClaw. Пишите сообщения — они уйдут агенту. /stop — выйти."
  );
}

export async function handleOpenClawStop(ctx: Context) {
  const chatId = getChatId(ctx);
  if (!chatId) return;
  setMode(chatId, "calendar");
  sessions.clear(chatId);
  await ctx.reply("Вышел из чата с OpenClaw.");
}

export async function handleOpenClawText(ctx: Context) {
  const chatId = getChatId(ctx);
  if (!chatId) return;
  if (!sessions.isActive(chatId)) return;

  const userId = ctx.from?.id ?? ctx.chat?.id;
  if (userId != null) {
    const linked = await hasToken(String(userId));
    if (!linked) {
      setMode(chatId, "calendar");
      sessions.clear(chatId);
      await ctx.reply(
        "Режим OpenClaw доступен только после привязки календаря. Отправьте /start и войдите через Google."
      );
      return;
    }
  }

  const text = "text" in ctx.message ? ctx.message.text : "";
  if (!text.trim()) return;

  sessions.appendUser(chatId, text);
  const history = sessions.getOrCreate(chatId);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: getOpenClawSystemPrompt() },
    ...history,
  ];

  await ctx.sendChatAction("typing");
  try {
    const reply = await sendChat(messages);
    sessions.appendAssistant(chatId, reply);
    await ctx.reply(reply || "—");
  } catch (err) {
    sessions.clear(chatId);
    await ctx.reply(formatOpenClawError(err) + " Режим чата сброшен.");
  }
}
