import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { createBot } from "./bot.js";
import { startOAuthServer } from "./oauthServer.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const bot = createBot(token);

startOAuthServer({
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI?.trim(),
});

const commands = [
  { command: "help", description: "Справка по командам" },
  { command: "status", description: "Статус привязки календаря" },
  { command: "new", description: "Создать встречу из фразы" },
  { command: "today", description: "Встречи на сегодня" },
  { command: "week", description: "Встречи на неделю" },
];

bot.launch().then(async () => {
  await bot.telegram.setMyCommands(commands);
  console.log("Bot started (long polling)");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
