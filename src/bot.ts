import { Telegraf } from "telegraf";
import { handleStart, handleHelp } from "./commands/start.js";
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
    bot.on("text", handleOpenClawText);
  }

  return bot;
}
