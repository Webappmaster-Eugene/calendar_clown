import { Telegraf, type Context } from "telegraf";
import { handleStart, handleHelp } from "./commands/start.js";
import { handleAuth } from "./commands/auth.js";
import { handleNew } from "./commands/createEvent.js";
import { handleToday, handleWeek } from "./commands/listEvents.js";
import { handleVoice } from "./commands/voiceEvent.js";
import { handleStatus } from "./commands/status.js";
import { handleExpensesCommand, handleCalendarCommand, handleCategoriesButton, handleModeCommand } from "./commands/expenseMode.js";
import { handleCancel, handleCancelRecurringCallback } from "./commands/cancelEvent.js";
import { handleExpenseText } from "./commands/addExpense.js";
import { handleReportButton, handleReportCallback, handleComparisonButton, handleStatsButton } from "./commands/expenseReport.js";
import { handleExcelButton, handleExcelCallback } from "./commands/expenseExcel.js";
import { handleUndoButton, handleUndoCallback } from "./commands/expenseUndo.js";
import { handleAdminCommand, handleAdminCallback, handleAdminTextInput } from "./commands/admin.js";
import { handleStatsCommand } from "./commands/adminStats.js";
import { handleTranscribeCommand } from "./commands/transcribeMode.js";
import { handleDigestCommand, handleRubricsButton, handleDigestNowButton } from "./commands/digestMode.js";
import { handleBroadcastCommand, handleBroadcastText } from "./commands/broadcastMode.js";
import {
  handleNotableDatesCommand,
  handleUpcomingDatesButton,
  handleAllDatesButton,
  handleAddDateButton,
  handleDeleteDateButton,
  handleNotableDateDeleteCallback,
  handleNotableDatesText,
} from "./commands/notableDatesMode.js";
import { accessControlMiddleware } from "./middleware/auth.js";
import { isExpenseMode, isBroadcastMode, isNotableDatesMode } from "./middleware/expenseMode.js";

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // Access control — restrict to allowed users
  bot.use(accessControlMiddleware());

  // ─── Commands ───────────────────────────────────────────────────────

  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command("auth", handleAuth);
  bot.command("status", handleStatus);
  bot.command("new", handleNew);
  bot.command("today", handleToday);
  bot.command("week", handleWeek);
  bot.command("list", handleToday);

  // Mode switching commands
  bot.command("expenses", handleExpensesCommand);
  bot.command("calendar", handleCalendarCommand);
  bot.command("transcribe", handleTranscribeCommand);
  bot.command("mode", handleModeCommand);
  bot.command("cancel", handleCancel);
  bot.command("digest", handleDigestCommand);
  bot.command("broadcast", handleBroadcastCommand);
  bot.command("dates", handleNotableDatesCommand);

  // Admin commands
  bot.command("admin", handleAdminCommand);
  bot.command("stats", handleStatsCommand);

  // ─── Callback queries (inline buttons) ──────────────────────────────

  bot.action(/^report:/, handleReportCallback);
  bot.action(/^report_year:/, handleReportCallback);
  bot.action(/^compare:/, handleReportCallback);
  bot.action(/^stats:/, handleReportCallback);
  bot.action(/^excel:/, handleExcelCallback);
  bot.action(/^admin:/, handleAdminCallback);
  bot.action(/^undo:/, handleUndoCallback);
  bot.action(/^cancel_recurring:/, handleCancelRecurringCallback);
  bot.action(/^notable_delete:/, handleNotableDateDeleteCallback);
  bot.action("mode:calendar", async (ctx) => {
    await ctx.answerCbQuery("📅 Календарь");
    await handleCalendarCommand(ctx);
  });
  bot.action("mode:expenses", async (ctx) => {
    await ctx.answerCbQuery("💰 Расходы");
    await handleExpensesCommand(ctx);
  });
  bot.action("mode:transcribe", async (ctx) => {
    await ctx.answerCbQuery("🎙 Транскрибатор");
    await handleTranscribeCommand(ctx);
  });
  bot.action("mode:digest", async (ctx) => {
    await ctx.answerCbQuery("📰 Дайджест");
    await handleDigestCommand(ctx);
  });
  bot.action("mode:broadcast", async (ctx) => {
    await handleBroadcastCommand(ctx);
  });
  bot.action("mode:notable_dates", async (ctx) => {
    await handleNotableDatesCommand(ctx);
  });
  bot.action("noop", async (ctx) => { await ctx.answerCbQuery(); });

  // ─── Voice ──────────────────────────────────────────────────────────

  bot.on("voice", handleVoice);

  // ─── Mode switch buttons ──────────────────────────────────────────

  bot.hears("💰 Расходы", handleExpensesCommand);
  bot.hears("📅 Календарь", handleCalendarCommand);
  bot.hears("🎙 Транскрибатор", handleTranscribeCommand);
  bot.hears("📰 Дайджест", handleDigestCommand);
  bot.hears("📢 Рассылка", handleBroadcastCommand);
  bot.hears("🎉 Даты", handleNotableDatesCommand);

  // ─── Text messages (mode-specific buttons) ─────────────────────────

  // Expense mode buttons — only work in expense mode
  const expenseOnlyHandler = (handler: (ctx: Context) => Promise<void>) => {
    return async (ctx: Context) => {
      const tid = ctx.from?.id;
      if (tid != null && !await isExpenseMode(tid)) {
        return; // silently ignore outside expense mode
      }
      await handler(ctx);
    };
  };
  bot.hears("📊 Отчёт", expenseOnlyHandler(handleReportButton));
  bot.hears("📥 Excel", expenseOnlyHandler(handleExcelButton));
  bot.hears("📋 Категории", expenseOnlyHandler(handleCategoriesButton));
  bot.hears("📈 Сравнение", expenseOnlyHandler(handleComparisonButton));
  bot.hears("👥 Статистика", expenseOnlyHandler(handleStatsButton));
  bot.hears("↩️ Отменить", handleUndoButton);

  // Digest mode buttons
  bot.hears("📋 Мои рубрики", handleRubricsButton);
  bot.hears("▶️ Запустить сейчас", handleDigestNowButton);

  // Notable dates mode buttons
  bot.hears("📅 Ближайшие", handleUpcomingDatesButton);
  bot.hears("📋 Все даты", handleAllDatesButton);
  bot.hears("➕ Добавить", handleAddDateButton);
  bot.hears("🗑 Удалить", handleDeleteDateButton);

  // Text messages catch-all (expense input, broadcast, notable dates)
  bot.on("text", async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return next();

    // Skip commands
    if (ctx.message.text.startsWith("/")) return next();

    // Admin text input (waiting for user ID)
    const consumed = await handleAdminTextInput(ctx);
    if (consumed) return;

    // Notable dates mode — text input for adding dates
    if (await isNotableDatesMode(telegramId)) {
      const handled = await handleNotableDatesText(ctx);
      if (handled) return;
      return next();
    }

    // Broadcast mode — send text to all tribe members
    if (await isBroadcastMode(telegramId)) {
      await handleBroadcastText(ctx);
      return;
    }

    // Only process in expense mode
    if (!await isExpenseMode(telegramId)) return next();

    await handleExpenseText(ctx);
  });

  return bot;
}
