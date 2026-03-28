import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

// OpenTelemetry — must be initialized before other imports
import { shutdownTelemetry } from "./telemetry.js";

import { createBot } from "./bot.js";
import { setBotSendMessage } from "./botInstance.js";
import { startOAuthServer } from "./oauthServer.js";
import { runMigrations, runDrizzleMigrations } from "./db/migrate.js";
import { closePool, setDatabaseAvailable, isDatabaseAvailable } from "./db/connection.js";
import { ensureUser } from "./expenses/repository.js";
import { initTranscribeQueue, startTranscribeWorker, closeTranscribeQueue, startStaleJobCleaner, stopStaleJobCleaner, startWorkerHealthMonitor, stopWorkerHealthMonitor } from "./transcribe/queue.js";
import { createTranscribeProcessor } from "./transcribe/worker.js";
import { getDistinctUsersWithUndelivered } from "./transcribe/repository.js";
import { deliverCompletedInOrder, setDeliveryBotRef } from "./transcribe/deliveryQueue.js";
import { isDigestConfigured, isDigestReady } from "./digest/telegramClient.js";
import { disconnectAll as disconnectAllMtprotoSessions } from "./digest/sessionManager.js";
import { startDigestScheduler, stopDigestScheduler } from "./digest/scheduler.js";
import { setDigestBotRef } from "./commands/digestMode.js";
import { setAuthBotRef } from "./commands/digestAuth.js";
import { startNotableDatesScheduler, stopNotableDatesScheduler } from "./notable-dates/scheduler.js";
import { startGoalsScheduler, stopGoalsScheduler } from "./goals/scheduler.js";
import { startRemindersScheduler, stopRemindersScheduler } from "./reminders/scheduler.js";
import { startTasksScheduler, stopTasksScheduler } from "./tasks/scheduler.js";
import { initProxyAgent } from "./utils/proxyAgent.js";
import { clearAllBatches } from "./chat/messageBatcher.js";
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
      await runDrizzleMigrations();
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

  const telegramAgent = await initProxyAgent();
  const bot = createBot(token!, telegramAgent);

  // Register bot's sendMessage for API broadcast route
  setBotSendMessage((chatId, text) => bot.telegram.sendMessage(chatId, text));

  // Initialize Redis + BullMQ for voice transcription queue
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    try {
      initTranscribeQueue(redisUrl);
      setDeliveryBotRef(bot);
      const transcribeProcessor = createTranscribeProcessor(bot);
      startTranscribeWorker(redisUrl, transcribeProcessor, bot);
      startStaleJobCleaner(bot);
      startWorkerHealthMonitor(redisUrl, transcribeProcessor, bot);

      // Recovery: deliver any undelivered results from before restart
      try {
        const usersToDeliver = await getDistinctUsersWithUndelivered();
        for (const userId of usersToDeliver) {
          deliverCompletedInOrder(bot, userId);
        }
        if (usersToDeliver.length > 0) {
          log.info(`Recovery: triggered delivery for ${usersToDeliver.length} user(s).`);
        }
      } catch (err) {
        log.error("Recovery delivery failed:", err instanceof Error ? err.message : err);
      }

      log.info("Transcribe queue initialized (Redis).");
    } catch (err) {
      log.error("Redis initialization failed — transcribe mode disabled.");
      log.error("Error:", err instanceof Error ? err.message : err);
    }
  } else {
    log.info("REDIS_URL not set — transcribe mode disabled.");
  }

  // Set bot reference for MTProto web auth notifications
  setAuthBotRef(bot);

  // Initialize digest scheduler (GramJS + cron)
  if (await isDigestReady()) {
    setDigestBotRef(bot);
    startDigestScheduler(bot);
    log.info("Digest mode enabled (MTProto configured).");
  } else if (isDigestConfigured()) {
    log.warn("Digest credentials set but session file missing. Run `npm run tg-auth`.");
  } else {
    log.info("TELEGRAM_PARSER_API_ID not set — digest mode disabled.");
  }

  // Initialize DB-dependent schedulers only if connection actually succeeded
  if (isDatabaseAvailable()) {
    startNotableDatesScheduler(bot);
    log.info("Notable dates scheduler enabled.");

    startGoalsScheduler(bot);
    log.info("Goals scheduler enabled.");

    startRemindersScheduler(bot);
    log.info("Reminders scheduler enabled.");

    startTasksScheduler(bot);
    log.info("Tasks scheduler enabled.");
  } else if (process.env.DATABASE_URL) {
    log.warn("DATABASE_URL is set but DB is unavailable — schedulers not started.");
  }

  startOAuthServer({
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI?.trim(),
  });

  const commands = [
    { command: "help", description: "Справка по командам" },
    { command: "mode", description: "Выбор режима работы" },
    { command: "new", description: "Создать встречу из фразы" },
    { command: "today", description: "Встречи на сегодня" },
    { command: "week", description: "Встречи на неделю" },
    { command: "cancel", description: "Отменить встречу" },
    { command: "status", description: "Статус привязки календаря" },
    { command: "auth", description: "Привязать Google Календарь" },
    { command: "calendar", description: "Режим календаря" },
    { command: "expenses", description: "Режим учёта расходов" },
    { command: "transcribe", description: "Режим транскрибатора" },
    { command: "simplifier", description: "Упрощение текста" },
    { command: "gandalf", description: "База знаний" },
    { command: "digest", description: "Дайджест телеграм-каналов" },
    { command: "dates", description: "Знаменательные даты" },
    { command: "neuro", description: "AI-чат с нейросетью" },
    { command: "wishlist", description: "Списки желаний" },
    { command: "goals", description: "Хранитель целей" },
    { command: "reminders", description: "Напоминания" },
    { command: "osint", description: "Поиск информации" },
    { command: "summarizer", description: "Учёт достижений" },
    { command: "blogger", description: "Генерация постов" },
    { command: "tasks", description: "Трекер задач" },
    { command: "broadcast", description: "Рассылка сообщений" },
    { command: "admin", description: "Управление пользователями" },
    { command: "stats", description: "Статистика бота" },
  ];

  await bot.launch();
  await bot.telegram.setMyCommands(commands);
  log.info("Bot started (long polling)");

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down...`);
    bot.stop(signal);
    clearAllBatches();
    disconnectAllMtprotoSessions();
    stopDigestScheduler();
    stopNotableDatesScheduler();
    stopGoalsScheduler();
    stopRemindersScheduler();
    stopTasksScheduler();
    stopWorkerHealthMonitor();
    stopStaleJobCleaner();
    await closeTranscribeQueue();
    await closePool();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
