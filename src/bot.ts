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
import { handleUndoCallback } from "./commands/expenseUndo.js";
import { handleAdminCommand, handleAdminCallback, handleAdminTextInput, handleOnboardRequest } from "./commands/admin.js";
import { handleStatsCommand } from "./commands/adminStats.js";
import { handleTranscribeCommand, handleTranscribeHistoryButton, handleClearQueueButton, handleTranscribeHistoryCallback, handleTranscribeFullCallback } from "./commands/transcribeMode.js";
import { handleDigestCommand, handleRubricsButton, handleDigestNowButton, handleCreateRubricButton, handleDigestText } from "./commands/digestMode.js";
import { handleBroadcastCommand, handleBroadcastText } from "./commands/broadcastMode.js";
import {
  handleNotableDatesCommand,
  handleUpcomingDatesButton,
  handleWeekDatesButton,
  handleMonthDatesButton,
  handleAllDatesButton,
  handleAddDateButton,
  handleEditDateButton,
  handleDeleteDateButton,
  handleNotableDateDeleteCallback,
  handleNotableDateEditCallback,
  handleNotableDateEditFieldCallback,
  handleNotableDatePriorityCallback,
  handleNotableDatesText,
} from "./commands/notableDatesMode.js";
import {
  handleNotesCommand,
  handleNewNoteButton,
  handleTopicsButton,
  handleImportantButton,
  handleUrgentButton,
  handleAllNotesButton,
  handleNoteTopicCallback,
  handleNewTopicCallback,
  handleViewTopicCallback,
  handleDeleteTopicCallback,
  handleNotesPageCallback,
  handleNoteActionCallback,
  handleNoteMoveCallback,
  handleNoteMoveToCallback,
  handleNotesText,
} from "./commands/notesMode.js";
import { accessControlMiddleware } from "./middleware/auth.js";
import { isExpenseMode, isBroadcastMode, isNotableDatesMode, isTranscribeMode, isNotesMode, isDigestMode } from "./middleware/expenseMode.js";

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
  bot.command("notes", handleNotesCommand);

  // Admin commands
  bot.command("admin", handleAdminCommand);
  bot.command("stats", handleStatsCommand);

  // ─── Callback queries (inline buttons) ──────────────────────────────

  bot.action("onboard_request", handleOnboardRequest);
  bot.action(/^report:/, handleReportCallback);
  bot.action(/^report_year:/, handleReportCallback);
  bot.action(/^compare:/, handleReportCallback);
  bot.action(/^stats:/, handleReportCallback);
  bot.action(/^excel:/, handleExcelCallback);
  bot.action(/^admin:/, handleAdminCallback);
  bot.action(/^undo:/, handleUndoCallback);
  bot.action(/^cancel_recurring:/, handleCancelRecurringCallback);
  bot.action(/^notable_delete:/, handleNotableDateDeleteCallback);
  bot.action(/^notable_edit_field:/, handleNotableDateEditFieldCallback);
  bot.action(/^notable_edit:/, handleNotableDateEditCallback);
  bot.action(/^notable_priority:/, handleNotableDatePriorityCallback);
  bot.action(/^tr_hist:/, handleTranscribeHistoryCallback);
  bot.action(/^tr_full:/, handleTranscribeFullCallback);

  // Notes callbacks
  bot.action(/^note_topic:/, handleNoteTopicCallback);
  bot.action("note_new_topic", handleNewTopicCallback);
  bot.action(/^note_view_topic:/, handleViewTopicCallback);
  bot.action(/^note_del_topic:/, handleDeleteTopicCallback);
  bot.action(/^notes_page:/, handleNotesPageCallback);
  bot.action(/^note_view:/, handleNoteActionCallback);
  bot.action(/^note_del:/, handleNoteActionCallback);
  bot.action(/^note_imp:/, handleNoteActionCallback);
  bot.action(/^note_urg:/, handleNoteActionCallback);
  bot.action(/^note_move:/, handleNoteMoveCallback);
  bot.action(/^note_move_to:/, handleNoteMoveToCallback);

  // Mode switch inline callbacks
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
  bot.action("mode:admin", async (ctx) => {
    await ctx.answerCbQuery("👑 Управление");
    await handleAdminCommand(ctx);
  });
  bot.action("mode:notable_dates", async (ctx) => {
    await handleNotableDatesCommand(ctx);
  });
  bot.action("mode:notes", async (ctx) => {
    await ctx.answerCbQuery("📝 Заметки");
    await handleNotesCommand(ctx);
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
  bot.hears("👑 Управление", handleAdminCommand);
  bot.hears("🎉 Даты", handleNotableDatesCommand);
  bot.hears("📝 Заметки", handleNotesCommand);
  bot.hears("🏠 Главное меню", handleModeCommand);

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

  // Digest mode buttons
  bot.hears("📋 Мои рубрики", handleRubricsButton);
  bot.hears("▶️ Запустить сейчас", handleDigestNowButton);
  bot.hears("➕ Создать рубрику", handleCreateRubricButton);

  // Transcribe mode buttons
  bot.hears("📋 История", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isTranscribeMode(tid)) {
      await handleTranscribeHistoryButton(ctx);
    }
  });
  bot.hears("🗑 Очистить очередь", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isTranscribeMode(tid)) {
      await handleClearQueueButton(ctx);
    }
  });

  // Notes mode buttons
  bot.hears("📝 Новая заметка", handleNewNoteButton);
  bot.hears("📂 Мои рубрики", handleTopicsButton);
  bot.hears("⭐ Важное", handleImportantButton);
  bot.hears("🔥 Срочное", handleUrgentButton);
  bot.hears("📋 Все заметки", handleAllNotesButton);

  // Notable dates mode buttons
  bot.hears("📅 Ближайшие", handleUpcomingDatesButton);
  bot.hears("📅 На неделе", handleWeekDatesButton);
  bot.hears("📅 За месяц", handleMonthDatesButton);
  bot.hears("📋 Все даты", handleAllDatesButton);
  bot.hears("➕ Добавить", handleAddDateButton);
  bot.hears("✏️ Изменить", handleEditDateButton);
  bot.hears("🗑 Удалить", handleDeleteDateButton);

  // Text messages catch-all (priority order)
  bot.on("text", async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return next();

    // Skip commands
    if (ctx.message.text.startsWith("/")) return next();

    // Admin text input (waiting for user ID)
    const consumed = await handleAdminTextInput(ctx);
    if (consumed) return;

    // Notes mode — text input for creating notes/topics
    if (await isNotesMode(telegramId)) {
      const handled = await handleNotesText(ctx);
      if (handled) return;
      return next();
    }

    // Notable dates mode — text input for adding dates
    if (await isNotableDatesMode(telegramId)) {
      const handled = await handleNotableDatesText(ctx);
      if (handled) return;
      return next();
    }

    // Digest mode — interactive rubric creation
    if (await isDigestMode(telegramId)) {
      const handled = await handleDigestText(ctx);
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
