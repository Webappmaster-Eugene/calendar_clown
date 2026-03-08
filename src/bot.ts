import { Telegraf } from "telegraf";
import { handleStart, handleHelp, handleMenu, handleMenuSwitch } from "./commands/start.js";
import { handleAuth } from "./commands/auth.js";
import { handleNew } from "./commands/createEvent.js";
import { handleToday, handleWeek } from "./commands/listEvents.js";
import { handleVoice } from "./commands/voiceEvent.js";
import { handleSend } from "./commands/sendMessage.js";
import {
  handleOpenClaw,
  handleOpenClawStop,
  handleOpenClawText,
} from "./commands/openclawChat.js";
import { getMode } from "./chatMode.js";
import { recordChat } from "./userChats.js";
import { messageLogger } from "./db/messageLogger.js";

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.use(async (ctx, next) => {
    await recordChat(ctx);
    return messageLogger(ctx, next);
  });

  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command("auth", handleAuth);
  bot.command("new", handleNew);
  bot.command("today", handleToday);
  bot.command("week", handleWeek);
  bot.command("list", handleToday);
  bot.command("send", handleSend);
  bot.on("voice", handleVoice);

  if (process.env.OPENCLAW_GATEWAY_TOKEN?.trim()) {
    bot.command("openclaw", handleOpenClaw);
    bot.command("stop", handleOpenClawStop);
    bot.command("menu", handleMenu);
    bot.on("text", async (ctx) => {
      if (await handleMenuSwitch(ctx)) return;
      const chatId = ctx.chat?.id != null ? String(ctx.chat.id) : null;
      if (chatId && getMode(chatId) === "openclaw") {
        return handleOpenClawText(ctx);
      }
      await ctx.reply(
        "Используйте /new для встречи или выберите OpenClaw в меню."
      );
    });
  }

  return bot;
}
