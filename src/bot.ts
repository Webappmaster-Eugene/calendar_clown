import { Telegraf } from "telegraf";
import { handleStart, handleHelp } from "./commands/start.js";
import { handleNew } from "./commands/createEvent.js";
import { handleToday, handleWeek } from "./commands/listEvents.js";

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command("new", handleNew);
  bot.command("today", handleToday);
  bot.command("week", handleWeek);
  bot.command("list", handleToday);

  return bot;
}
