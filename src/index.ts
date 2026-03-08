import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { createBot } from "./bot.js";
import { startSendMessageApi } from "./sendMessageApi.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const bot = createBot(token);

const apiKey = process.env.SEND_MESSAGE_API_KEY?.trim();
if (apiKey) {
  startSendMessageApi(bot, apiKey);
}

bot.launch().then(() => {
  console.log("Bot started (long polling)");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
