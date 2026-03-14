import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { createBot } from "./bot.js";
import { startOAuthServer } from "./oauthServer.js";
import { runMigrations } from "./db/migrate.js";
import { closePool, setDatabaseAvailable } from "./db/connection.js";
import { ensureUser } from "./expenses/repository.js";
import { initTranscribeQueue, startTranscribeWorker, closeTranscribeQueue } from "./transcribe/queue.js";
import { createTranscribeProcessor } from "./transcribe/worker.js";
import { isDigestConfigured } from "./digest/telegramClient.js";
import { startDigestScheduler, stopDigestScheduler } from "./digest/scheduler.js";
import { setDigestBotRef } from "./commands/digestMode.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("app");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  log.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

async function main(): Promise<void> {
  // Initialize database if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    try {
      log.info("Connecting to PostgreSQL...");
      await runMigrations();
      log.info("Database migrations completed.");

      // Auto-register bootstrap admin in DB
      const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
      if (adminId) {
        const numericId = parseInt(adminId, 10);
        if (!isNaN(numericId)) {
          await ensureUser(numericId, null, "Admin", null, true);
          log.info(`Bootstrap admin ${numericId} registered.`);
        }
      }

      setDatabaseAvailable(true);
    } catch (err) {
      log.error("=".repeat(60));
      log.error("PostgreSQL initialization failed — expense tracking disabled.");
      log.error("Calendar features will continue to work normally.");
      log.error("Error:", err instanceof Error ? err.message : err);
      log.error("=".repeat(60));
    }
  } else {
    log.info("DATABASE_URL not set — expense tracking disabled.");
  }

  const bot = createBot(token!);

  // Initialize Redis + BullMQ for voice transcription queue
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    try {
      initTranscribeQueue(redisUrl);
      startTranscribeWorker(redisUrl, createTranscribeProcessor(bot));
      log.info("Transcribe queue initialized (Redis).");
    } catch (err) {
      log.error("Redis initialization failed — transcribe mode disabled.");
      log.error("Error:", err instanceof Error ? err.message : err);
    }
  } else {
    log.info("REDIS_URL not set — transcribe mode disabled.");
  }

  // Initialize digest scheduler (GramJS + cron)
  if (isDigestConfigured()) {
    setDigestBotRef(bot);
    startDigestScheduler(bot);
    log.info("Digest mode enabled (MTProto configured).");
  } else {
    log.info("TELEGRAM_PARSER_API_ID not set — digest mode disabled.");
  }

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
    { command: "transcribe", description: "Режим транскрибатора" },
    { command: "cancel", description: "Отменить встречу" },
    { command: "digest", description: "Дайджест телеграм-каналов" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "admin", description: "Управление пользователями" },
  ];

  await bot.launch();
  await bot.telegram.setMyCommands(commands);
  log.info("Bot started (long polling)");

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down...`);
    bot.stop(signal);
    stopDigestScheduler();
    await closeTranscribeQueue();
    await closePool();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
