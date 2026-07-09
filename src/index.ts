import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

// OpenTelemetry — must be initialized before other imports
import { shutdownTelemetry } from "./telemetry.js";

import { createBot } from "./bot.js";
import { setBotSendMessage, setBotSendDocument } from "./botInstance.js";
import { startOAuthServer } from "./oauthServer.js";
import { runDrizzleMigrations } from "./db/migrate.js";
import { query, closePool, setDatabaseAvailable, isDatabaseAvailable } from "./db/connection.js";
import { ensureUser } from "./expenses/repository.js";
import { initTranscribeQueue, startTranscribeWorker, closeTranscribeQueue, startStaleJobCleaner, stopStaleJobCleaner, startWorkerHealthMonitor, stopWorkerHealthMonitor } from "./transcribe/queue.js";
import { createTranscribeProcessor } from "./transcribe/worker.js";
import { getDistinctUsersWithUndelivered } from "./transcribe/repository.js";
import { deliverCompletedInOrder, setDeliveryBotRef } from "./transcribe/deliveryQueue.js";
import { setSimplifierDeliveryBotRef, deliverSimplificationsInOrder } from "./simplifier/deliveryQueue.js";
import { getDistinctUsersWithUndeliveredSimplifications, markStaleSimplificationsAsFailed } from "./simplifier/repository.js";
import { isDigestConfigured, isDigestReady } from "./digest/telegramClient.js";
import { disconnectAll as disconnectAllMtprotoSessions } from "./digest/sessionManager.js";
import { startDigestScheduler, stopDigestScheduler } from "./digest/scheduler.js";
import { setDigestBotRef } from "./commands/digestMode.js";
import { setAuthBotRef, startWebTokenCleanup, stopWebTokenCleanup } from "./commands/digestAuth.js";
import { setBankPushBotRef } from "./expenses/bankPush/confirm.js";
import { startNotableDatesScheduler, stopNotableDatesScheduler } from "./notable-dates/scheduler.js";
import { startGoalsScheduler, stopGoalsScheduler } from "./goals/scheduler.js";
import { startRemindersScheduler, stopRemindersScheduler } from "./reminders/scheduler.js";
import { startTasksScheduler, stopTasksScheduler } from "./tasks/scheduler.js";
import { initProxyAgent, initOpenRouterAgent } from "./utils/proxyAgent.js";
import { startPollWatchdog, stopPollWatchdog } from "./health/pollWatchdog.js";
import { clearAllBatches } from "./chat/messageBatcher.js";
import { validateSttModels } from "./voice/healthCheck.js";
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
    // A connection failure is tolerated — the calendar keeps working without the
    // DB. A *migration* failure is not: it means the schema is inconsistent, so we
    // crash loud (below) instead of silently booting a half-migrated bot.
    let dbConnected = false;
    try {
      log.info("Connecting to PostgreSQL...");
      await query("SELECT 1");
      dbConnected = true;
    } catch (err) {
      log.error("=".repeat(60));
      log.error("PostgreSQL connection failed — expense tracking disabled.");
      log.error("Calendar features will continue to work normally.");
      log.error("Error:", err instanceof Error ? err.message : err);
      log.error("=".repeat(60));
    }

    if (dbConnected) {
      // Docker restarts the process, so a broken migration surfaces as a visible
      // crash-loop rather than a hidden degradation that swallows schema drift.
      try {
        await runDrizzleMigrations();
        log.info("Database migrations completed.");
      } catch (err) {
        log.error("=".repeat(60));
        log.error("Database migration FAILED — refusing to start with an inconsistent schema.");
        log.error("Error:", err instanceof Error ? err.message : err);
        log.error("=".repeat(60));
        process.exit(1);
      }

      setDatabaseAvailable(true);

      // Auto-register bootstrap admin (best-effort; the DB is already healthy).
      const adminId = process.env.ADMIN_TELEGRAM_ID?.trim();
      if (adminId) {
        const numericId = parseInt(adminId, 10);
        if (!isNaN(numericId)) {
          try {
            await ensureUser(numericId, null, "Admin", null, true);
            log.info(`Bootstrap admin ${numericId} registered.`);
          } catch (err) {
            log.error("Bootstrap admin registration failed:", err instanceof Error ? err.message : err);
          }
        }
      }
    }
  } else {
    log.info("DATABASE_URL not set — expense tracking disabled.");
  }

  const telegramAgent = await initProxyAgent();
  await initOpenRouterAgent();
  const bot = createBot(token!, telegramAgent);

  // Register bot's sendMessage for API broadcast route
  setBotSendMessage((chatId, text) => bot.telegram.sendMessage(chatId, text));
  setBotSendDocument((chatId, doc, extra) =>
    bot.telegram.sendDocument(chatId, { source: doc.source, filename: doc.filename }, extra ?? {})
  );

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

  // Set bot reference for simplifier ordered delivery
  setSimplifierDeliveryBotRef(bot);

  // Simplifier recovery: deliver any undelivered results from before restart
  if (isDatabaseAvailable()) {
    try {
      const staleCount = await markStaleSimplificationsAsFailed(30);
      if (staleCount > 0) {
        log.info(`Simplifier recovery: marked ${staleCount} stale simplification(s) as failed.`);
      }

      const simpUsersToDeliver = await getDistinctUsersWithUndeliveredSimplifications();
      for (const userId of simpUsersToDeliver) {
        deliverSimplificationsInOrder(bot, userId);
      }
      if (simpUsersToDeliver.length > 0) {
        log.info(`Simplifier recovery: triggered delivery for ${simpUsersToDeliver.length} user(s).`);
      }
    } catch (err) {
      log.error("Simplifier recovery failed:", err instanceof Error ? err.message : err);
    }
  }

  // Set bot reference for MTProto web auth notifications
  setAuthBotRef(bot);
  startWebTokenCleanup();

  // Set bot reference for bank push-notification webhook confirmations
  setBankPushBotRef(bot);

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

  // Configure bot commands and menu button before launch() —
  // launch() may block while connecting through proxy
  try {
    await bot.telegram.setMyCommands(commands);
  } catch (err) {
    log.warn("Failed to set bot commands: %s", err instanceof Error ? err.message : err);
  }

  // Surface STT model deprecations at boot, not on the first user voice message.
  void validateSttModels().catch((err) => {
    log.debug("STT health-check threw: %s", err instanceof Error ? err.message : err);
  });

  const webappUrl = process.env.WEBAPP_URL?.trim();
  if (webappUrl) {
    try {
      await bot.telegram.setChatMenuButton({
        menuButton: { type: "web_app", text: "Открыть", web_app: { url: webappUrl } },
      });
      log.info("Mini App menu button configured: %s", webappUrl);
    } catch (err) {
      log.warn("Failed to set Mini App menu button: %s", err instanceof Error ? err.message : err);
    }
  } else {
    log.warn("WEBAPP_URL not set — Mini App menu button and addToHomeScreen() will not work.");
  }

  // Register shutdown handlers BEFORE bot.launch() —
  // Telegraf 4.16 awaits the polling loop inside launch(), so code after it never executes
  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down...`);
    stopPollWatchdog();
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
    stopWebTokenCleanup();
    await closeTranscribeQueue();
    await closePool();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 5_000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // bot.launch() in Telegraf 4.16 never resolves (awaits polling loop).
      // Use the onLaunch callback to know when the bot is ready.
      await new Promise<void>((resolve, reject) => {
        let started = false;
        bot.launch({}, () => { started = true; resolve(); })
          .catch((err) => {
            if (!started) {
              reject(err);
            } else {
              // Polling loop terminated after a successful start. The process
              // would otherwise stay alive with a dead poller (HTTP server keeps
              // it running), silently ignoring messages. Exit so Docker's
              // `restart: unless-stopped` brings up a fresh process.
              log.error(
                "Bot polling loop terminated after start: %s. Exiting for restart.",
                err instanceof Error ? err.message : err,
              );
              process.exit(1);
            }
          });
      });
      log.info("Bot started (long polling)");
      // Guard against a silently wedged poller (stale proxy sockets / stuck
      // getUpdates) that never rejects the promise above.
      startPollWatchdog(bot);
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      log.warn(
        "Bot launch attempt %d/%d failed: %s. Retrying in %ds...",
        attempt, MAX_RETRIES,
        err instanceof Error ? err.message : err,
        delay / 1000,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
