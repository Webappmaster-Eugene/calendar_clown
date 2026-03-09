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

startSendMessageApi(bot, {
  apiKey: process.env.SEND_MESSAGE_API_KEY?.trim(),
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI?.trim(),
});

const defaultCommands = [
  { command: "help", description: "Справка по командам" },
  { command: "new", description: "Создать встречу из фразы" },
  { command: "today", description: "Встречи на сегодня" },
  { command: "week", description: "Встречи на неделю" },
  { command: "send", description: "Отправить сообщение пользователю (доверенные)" },
];
const openclawCommands = [
  { command: "menu", description: "Меню: Календарь / OpenClaw / Отправить сообщение" },
  { command: "openclaw", description: "Режим OpenClaw — задачи агенту" },
  { command: "stop", description: "Выйти из чата OpenClaw" },
];

bot.launch().then(async () => {
  const commands = process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
    ? [...defaultCommands, ...openclawCommands]
    : defaultCommands;
  await bot.telegram.setMyCommands(commands);
  console.log("Bot started (long polling)");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
