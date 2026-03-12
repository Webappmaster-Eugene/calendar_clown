import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { createBot } from "./bot.js";
import { startOAuthServer } from "./oauthServer.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/connection.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

async function main(): Promise<void> {
  // Initialize database if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    console.log("Connecting to PostgreSQL...");
    await runMigrations();
    console.log("Database migrations completed.");
  } else {
    console.log("DATABASE_URL not set — expense tracking disabled.");
  }

  const bot = createBot(token!);

  startOAuthServer({
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI?.trim(),
  });

  const commands = [
    { command: "help", description: "Справка по командам" },
    { command: "status", description: "Статус привязки календаря" },
    { command: "new", description: "Создать встречу из фразы" },
    { command: "today", description: "Встречи на сегодня" },
    { command: "week", description: "Встречи на неделю" },
    { command: "expenses", description: "Режим учёта расходов" },
    { command: "calendar", description: "Режим календаря" },
  ];

  await bot.launch();
  await bot.telegram.setMyCommands(commands);
  console.log("Bot started (long polling)");

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    bot.stop(signal);
    await closePool();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
