import { Telegraf } from "telegraf";
import { handleStart, handleHelp } from "./commands/start.js";
import { handleAuth } from "./commands/auth.js";
import { handleNew } from "./commands/createEvent.js";
import { handleToday, handleWeek } from "./commands/listEvents.js";
import { handleVoice } from "./commands/voiceEvent.js";
import { handleStatus } from "./commands/status.js";
import { handleExpensesCommand, handleCalendarCommand, handleCategoriesButton } from "./commands/expenseMode.js";
import { handleExpenseText } from "./commands/addExpense.js";
import { handleReportButton, handleReportCallback, handleComparisonButton, handleStatsButton } from "./commands/expenseReport.js";
import { handleExcelButton, handleExcelCallback } from "./commands/expenseExcel.js";
import { handleUndoButton } from "./commands/expenseUndo.js";
import { accessControlMiddleware } from "./middleware/auth.js";
import { isExpenseMode } from "./middleware/expenseMode.js";
import { trackUser } from "./users.js";

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // Access control — restrict to allowed users
  bot.use(accessControlMiddleware());

  // Track every user who interacts with the bot
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId != null) {
      await trackUser(String(userId));
    }
    return next();
  });

  // ─── Commands ───────────────────────────────────────────────────────

  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command("auth", handleAuth);
  bot.command("status", handleStatus);
  bot.command("new", handleNew);
  bot.command("today", handleToday);
  bot.command("week", handleWeek);
  bot.command("list", handleToday);

  // Expense mode commands
  bot.command("expenses", handleExpensesCommand);
  bot.command("calendar", handleCalendarCommand);

  // ─── Callback queries (inline buttons) ──────────────────────────────

  bot.action(/^report:/, handleReportCallback);
  bot.action(/^report_year:/, handleReportCallback);
  bot.action(/^compare:/, handleReportCallback);
  bot.action(/^stats:/, handleReportCallback);
  bot.action(/^excel:/, handleExcelCallback);
  bot.action("noop", async (ctx) => { await ctx.answerCbQuery(); });

  // ─── Voice ──────────────────────────────────────────────────────────

  bot.on("voice", handleVoice);

  // ─── Text messages (expense mode buttons + expense input) ───────────

  bot.hears("📊 Отчёт", handleReportButton);
  bot.hears("📥 Excel", handleExcelButton);
  bot.hears("📋 Категории", handleCategoriesButton);
  bot.hears("📈 Сравнение", handleComparisonButton);
  bot.hears("👥 Статистика", handleStatsButton);
  bot.hears("↩️ Отменить", handleUndoButton);
  bot.hears("🔙 Календарь", handleCalendarCommand);

  // Text messages in expense mode (catch-all for expense input)
  bot.on("text", async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return next();

    // Skip commands
    if (ctx.message.text.startsWith("/")) return next();

    // Only process in expense mode
    if (!isExpenseMode(telegramId)) return next();

    await handleExpenseText(ctx);
  });

  return bot;
}
