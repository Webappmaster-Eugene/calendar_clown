import type { Context } from "telegraf";
import { sendChat } from "../openclaw/chat.js";
import * as sessions from "../openclaw/sessions.js";

const SYSTEM_PROMPT =
  "You are a helpful assistant. Reply in the same language as the user.";

function getChatId(ctx: Context): string | null {
  const id = ctx.chat?.id;
  return id != null ? String(id) : null;
}

export async function handleOpenClaw(ctx: Context) {
  const chatId = getChatId(ctx);
  if (!chatId) return;

  const rawText = "text" in ctx.message ? ctx.message.text : "";
  const textAfterCommand = rawText.replace(/^\/openclaw\s*/i, "").trim();

  if (textAfterCommand) {
    await ctx.sendChatAction("typing");
    try {
      const reply = await sendChat([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: textAfterCommand },
      ]);
      await ctx.reply(reply || "—");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("OPENCLAW_GATEWAY_TOKEN")) {
        await ctx.reply("OpenClaw не настроен.");
      } else if (message.includes("abort") || message.includes("timeout")) {
        await ctx.reply("Таймаут запроса к OpenClaw.");
      } else {
        await ctx.reply("OpenClaw недоступен: " + message.slice(0, 200));
      }
    }
    return;
  }

  sessions.getOrCreate(chatId);
  await ctx.reply(
    "Режим OpenClaw. Пишите сообщения — они уйдут агенту. /stop — выйти."
  );
}

export async function handleOpenClawStop(ctx: Context) {
  const chatId = getChatId(ctx);
  if (!chatId) return;
  sessions.clear(chatId);
  await ctx.reply("Вышел из чата с OpenClaw.");
}

export async function handleOpenClawText(ctx: Context) {
  const chatId = getChatId(ctx);
  if (!chatId) return;
  if (!sessions.isActive(chatId)) return;

  const text = "text" in ctx.message ? ctx.message.text : "";
  if (!text.trim()) return;

  sessions.appendUser(chatId, text);
  const history = sessions.getOrCreate(chatId);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  await ctx.sendChatAction("typing");
  try {
    const reply = await sendChat(messages);
    sessions.appendAssistant(chatId, reply);
    await ctx.reply(reply || "—");
  } catch (err) {
    sessions.clear(chatId);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort") || message.includes("timeout")) {
      await ctx.reply("Таймаут запроса к OpenClaw. Режим чата сброшен.");
    } else {
      await ctx.reply(
        "OpenClaw недоступен: " + message.slice(0, 200) + ". Режим чата сброшен."
      );
    }
  }
}
