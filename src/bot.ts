import { Telegraf } from "telegraf";
import { handleStart, handleHelp } from "./commands/start.js";
import { handleAuth } from "./commands/auth.js";
import { handleNew } from "./commands/createEvent.js";
import { handleToday, handleWeek } from "./commands/listEvents.js";
import { handleVoice } from "./commands/voiceEvent.js";
import { handleStatus } from "./commands/status.js";
import { trackUser } from "./users.js";

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // Track every user who interacts with the bot
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId != null) {
      await trackUser(String(userId));
    }
    return next();
  });

  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command("auth", handleAuth);
  bot.command("status", handleStatus);
  bot.command("new", handleNew);
  bot.command("today", handleToday);
  bot.command("week", handleWeek);
  bot.command("list", handleToday);
  bot.on("voice", handleVoice);

  return bot;
}
