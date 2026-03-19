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
import { handleTranscribeCommand, handleTranscribeHistoryButton, handleClearQueueButton, handleQueueStatusButton, handleTranscribeHistoryCallback, handleTranscribeFullCallback, handleTranscribeDeleteCallback } from "./commands/transcribeMode.js";
import { handleAdminDataCallback, handleAdminDataTextInput } from "./commands/adminData.js";
import { handleBulkCallback } from "./utils/bulkSelect.js";
import { handleDigestCommand, handleRubricsButton, handleDigestNowButton, handleCreateRubricButton, handleDigestText, handleFolderImportButton, handleDigestFolderCallback, handleDigestFolderToCallback } from "./commands/digestMode.js";
import { handleMtprotoAuthButton, handleDigestAuthText } from "./commands/digestAuth.js";
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
  handleNotableDatesPageCallback,
  handleNotableDatesDocument,
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
  handleNoteVisibilityCallback,
  handlePublicNotesButton,
  handlePublicNotesPageCallback,
  handleViewTopicCallback,
  handleDeleteTopicCallback,
  handleNotesPageCallback,
  handleNoteActionCallback,
  handleNoteMoveCallback,
  handleNoteMoveToCallback,
  handleNotesText,
} from "./commands/notesMode.js";
import {
  handleGandalfCommand,
  handleGandalfCategoriesButton,
  handleGandalfNewEntryButton,
  handleGandalfAllEntriesButton,
  handleGandalfStatsButton,
  handleGandalfNewCatCallback,
  handleGandalfViewCatCallback,
  handleGandalfDelCatCallback,
  handleGandalfEntryCatCallback,
  handleGandalfPageCallback,
  handleGandalfEntryActionCallback,
  handleGandalfFilesCallback,
  handleGandalfOptionalCallback,
  handleGandalfStatsCallback,
  handleGandalfText,
  handleGandalfFileAttachment,
} from "./commands/gandalfMode.js";
import { handleNeuroCommand, handleNeuroText, handleNeuroClearButton } from "./commands/chatMode.js";
import {
  handleWishlistCommand,
  handleMyWishlistsButton,
  handleTribeWishlistsButton,
  handleNewWishlistButton,
  handleWlMyCallback,
  handleWlMyDelCallback,
  handleWlAddCallback,
  handleWlItemCallback,
  handleWlItemDelCallback,
  handleWlItemFilesCallback,
  handleWlTribeCallback,
  handleWlTribeUserCallback,
  handleWlReserveCallback,
  handleWlUnreserveCallback,
  handleWlPageCallback,
  handleWishlistText,
  handleWishlistFileAttachment,
} from "./commands/wishlistMode.js";
import { accessControlMiddleware, getUserMenuContext, canAccessMode } from "./middleware/auth.js";
import { isExpenseMode, isBroadcastMode, isNotableDatesMode, isTranscribeMode, isNotesMode, isDigestMode, isGandalfMode, isNeuroMode, isWishlistMode, isGoalsMode } from "./middleware/expenseMode.js";
import {
  handleGoalsCommand,
  handleMyGoalSetsButton,
  handleNewGoalSetButton,
  handleSharedGoalsButton,
  handleGoalSetCallback,
  handleGoalCallback,
  handleGoalPeriodCallback,
  handleGoalViewerCallback,
  handleGoalsPageCallback,
  handleGoalsText,
  handleGoalsVoice,
} from "./commands/goalsMode.js";

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
  bot.command("gandalf", handleGandalfCommand);
  bot.command("wishlist", handleWishlistCommand);
  bot.command("goals", handleGoalsCommand);
  bot.command("neuro", handleNeuroCommand);

  // Admin commands
  bot.command("admin", handleAdminCommand);
  bot.command("stats", handleStatsCommand);

  // ─── Callback queries (inline buttons) ──────────────────────────────

  bot.action("onboard_request", handleOnboardRequest);
  bot.action(/^report:/, handleReportCallback);
  bot.action(/^report_year:/, handleReportCallback);
  bot.action(/^compare:/, handleReportCallback);
  bot.action(/^stats:/, handleReportCallback);
  bot.action(/^drilldown:/, handleReportCallback);
  bot.action(/^excel:/, handleExcelCallback);
  bot.action(/^admin:/, handleAdminCallback);
  bot.action(/^undo:/, handleUndoCallback);
  bot.action(/^cancel_recurring:/, handleCancelRecurringCallback);
  bot.action(/^notable_page:/, handleNotableDatesPageCallback);
  bot.action(/^notable_delete:/, handleNotableDateDeleteCallback);
  bot.action(/^notable_edit_field:/, handleNotableDateEditFieldCallback);
  bot.action(/^notable_edit:/, handleNotableDateEditCallback);
  bot.action(/^notable_priority:/, handleNotableDatePriorityCallback);
  bot.action(/^tr_hist:/, handleTranscribeHistoryCallback);
  bot.action(/^tr_full:/, handleTranscribeFullCallback);
  bot.action(/^tr_del:/, handleTranscribeDeleteCallback);
  bot.action(/^tr_del_yes:/, handleTranscribeDeleteCallback);

  // Admin data management callbacks
  bot.action(/^adm_/, handleAdminDataCallback);

  // Bulk selection callbacks
  bot.action(/^bulk:/, handleBulkCallback);

  // Digest folder import callbacks
  bot.action(/^digest_folder:/, handleDigestFolderCallback);
  bot.action(/^digest_folder_to:/, handleDigestFolderToCallback);

  // Notes callbacks
  bot.action(/^note_topic:/, handleNoteTopicCallback);
  bot.action("note_new_topic", handleNewTopicCallback);
  bot.action(/^note_vis:/, handleNoteVisibilityCallback);
  bot.action(/^note_vis_toggle:/, handleNoteActionCallback);
  bot.action(/^pub_notes_page:/, handlePublicNotesPageCallback);
  bot.action(/^note_view_topic:/, handleViewTopicCallback);
  bot.action(/^note_del_topic:/, handleDeleteTopicCallback);
  bot.action(/^notes_page:/, handleNotesPageCallback);
  bot.action(/^note_view:/, handleNoteActionCallback);
  bot.action(/^note_del:/, handleNoteActionCallback);
  bot.action(/^note_imp:/, handleNoteActionCallback);
  bot.action(/^note_urg:/, handleNoteActionCallback);
  bot.action(/^note_move:/, handleNoteMoveCallback);
  bot.action(/^note_move_to:/, handleNoteMoveToCallback);

  // Gandalf callbacks
  bot.action("gandalf_new_cat", handleGandalfNewCatCallback);
  bot.action(/^gandalf_view_cat:/, handleGandalfViewCatCallback);
  bot.action(/^gandalf_del_cat:/, handleGandalfDelCatCallback);
  bot.action(/^gandalf_entry_cat:/, handleGandalfEntryCatCallback);
  bot.action(/^gandalf_page:/, handleGandalfPageCallback);
  bot.action(/^gandalf_view:/, handleGandalfEntryActionCallback);
  bot.action(/^gandalf_del:/, handleGandalfEntryActionCallback);
  bot.action(/^gandalf_files:/, handleGandalfFilesCallback);
  bot.action(/^gandalf_opt_date:/, handleGandalfOptionalCallback);
  bot.action(/^gandalf_opt_info:/, handleGandalfOptionalCallback);
  bot.action(/^gandalf_opt_done:/, handleGandalfOptionalCallback);
  bot.action(/^gandalf_stats:/, handleGandalfStatsCallback);

  // Wishlist callbacks
  bot.action(/^wl_my:/, handleWlMyCallback);
  bot.action(/^wl_my_del:/, handleWlMyDelCallback);
  bot.action(/^wl_add:/, handleWlAddCallback);
  bot.action(/^wl_item:/, handleWlItemCallback);
  bot.action(/^wl_item_del:/, handleWlItemDelCallback);
  bot.action(/^wl_item_files:/, handleWlItemFilesCallback);
  bot.action(/^wl_tribe:/, handleWlTribeCallback);
  bot.action(/^wl_tribe_user:/, handleWlTribeUserCallback);
  bot.action(/^wl_reserve:/, handleWlReserveCallback);
  bot.action(/^wl_unreserve:/, handleWlUnreserveCallback);
  bot.action(/^wl_page:/, handleWlPageCallback);

  // Goals callbacks
  bot.action(/^goal_set:/, handleGoalSetCallback);
  bot.action(/^goal_set_del:/, handleGoalSetCallback);
  bot.action(/^goal_set_vis:/, handleGoalSetCallback);
  bot.action(/^goal_set_add:/, handleGoalSetCallback);
  bot.action(/^goal_set_done:/, handleGoalSetCallback);
  bot.action(/^goal_set_viewers:/, handleGoalSetCallback);
  bot.action(/^goal_set_view:/, handleGoalSetCallback);
  bot.action(/^goal_done:/, handleGoalCallback);
  bot.action(/^goal_del:/, handleGoalCallback);
  bot.action(/^goal_period:/, handleGoalPeriodCallback);
  bot.action(/^goal_viewer_add:/, handleGoalViewerCallback);
  bot.action(/^goal_viewer_del:/, handleGoalViewerCallback);
  bot.action(/^goal_viewer_done:/, handleGoalViewerCallback);
  bot.action(/^goal_page:/, handleGoalsPageCallback);

  // Mode switch inline callbacks
  bot.action("mode:calendar", async (ctx) => {
    await ctx.answerCbQuery("📅 Календарь");
    await handleCalendarCommand(ctx);
  });
  bot.action("mode:expenses", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("expenses", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("💰 Расходы");
    await handleExpensesCommand(ctx);
  });
  bot.action("mode:transcribe", async (ctx) => {
    await ctx.answerCbQuery("🎙 Транскрибатор");
    await handleTranscribeCommand(ctx);
  });
  bot.action("mode:digest", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("digest", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
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
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("notable_dates", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await handleNotableDatesCommand(ctx);
  });
  bot.action("mode:notes", async (ctx) => {
    await ctx.answerCbQuery("📝 Заметки");
    await handleNotesCommand(ctx);
  });
  bot.action("mode:gandalf", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("gandalf", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("🧙 Гэндальф");
    await handleGandalfCommand(ctx);
  });
  bot.action("mode:wishlist", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("wishlist", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("🎁 Вишлист");
    await handleWishlistCommand(ctx);
  });
  bot.action("mode:neuro", async (ctx) => {
    await ctx.answerCbQuery("🧠 Нейро");
    await handleNeuroCommand(ctx);
  });
  bot.action("mode:goals", async (ctx) => {
    await ctx.answerCbQuery("🎯 Цели");
    await handleGoalsCommand(ctx);
  });
  bot.action("noop", async (ctx) => { await ctx.answerCbQuery(); });

  // ─── Voice ──────────────────────────────────────────────────────────

  bot.on("voice", handleVoice);

  // ─── Mode switch buttons ──────────────────────────────────────────

  bot.hears("💰 Расходы", handleExpensesCommand);
  bot.hears("📅 Календарь", handleCalendarCommand);
  bot.hears("🎙 Транскрибатор", handleTranscribeCommand);
  bot.hears("📰 Дайджест", handleDigestCommand);
  bot.hears("📢 Царская почта", handleBroadcastCommand);
  bot.hears("👑 Управление", handleAdminCommand);
  bot.hears("🎉 Даты", handleNotableDatesCommand);
  bot.hears("📝 Заметки", handleNotesCommand);
  bot.hears("🧙 Гэндальф", handleGandalfCommand);
  bot.hears("🎁 Вишлист", handleWishlistCommand);
  bot.hears("🧠 Нейро", handleNeuroCommand);
  bot.hears("🎯 Цели", handleGoalsCommand);
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
  bot.hears("📂 Импорт из папки", handleFolderImportButton);
  bot.hears("🔑 Привязать Telegram", handleMtprotoAuthButton);

  // Transcribe mode buttons
  bot.hears("📋 История", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isTranscribeMode(tid)) {
      await handleTranscribeHistoryButton(ctx);
    }
  });
  bot.hears("📊 Очередь", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isTranscribeMode(tid)) {
      await handleQueueStatusButton(ctx);
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
  bot.hears("🌐 Публичные заметки", handlePublicNotesButton);

  // Wishlist mode buttons
  bot.hears("🎁 Мои вишлисты", handleMyWishlistsButton);
  bot.hears("👀 Вишлисты семьи", handleTribeWishlistsButton);
  bot.hears("➕ Новый вишлист", handleNewWishlistButton);

  // Gandalf mode buttons
  bot.hears("📦 Категории", handleGandalfCategoriesButton);
  bot.hears("➕ Новая запись", handleGandalfNewEntryButton);
  bot.hears("📊 Статистика", handleGandalfStatsButton);
  bot.hears("📋 Все записи", handleGandalfAllEntriesButton);

  // Goals mode buttons
  bot.hears("📋 Мои наборы целей", handleMyGoalSetsButton);
  bot.hears("➕ Новый набор целей", handleNewGoalSetButton);
  bot.hears("👀 Цели друзей", handleSharedGoalsButton);

  // Neuro mode buttons
  bot.hears("🗑 Очистить историю", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isNeuroMode(tid)) {
      await handleNeuroClearButton(ctx);
    }
  });

  // Notable dates mode buttons
  bot.hears("📅 Ближайшие", handleUpcomingDatesButton);
  bot.hears("📅 На неделе", handleWeekDatesButton);
  bot.hears("📅 За месяц", handleMonthDatesButton);
  bot.hears("📋 Все даты", handleAllDatesButton);
  bot.hears("➕ Добавить", handleAddDateButton);
  bot.hears("✏️ Изменить", handleEditDateButton);
  bot.hears("🗑 Удалить", handleDeleteDateButton);

  // Photo/document handlers (gandalf file attachments)
  bot.on("photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return;
    if (await isGandalfMode(telegramId)) {
      await handleGandalfFileAttachment(ctx);
      return;
    }
    if (await isWishlistMode(telegramId)) {
      await handleWishlistFileAttachment(ctx);
      return;
    }
  });
  bot.on("document", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return;
    if (await isGandalfMode(telegramId)) {
      await handleGandalfFileAttachment(ctx);
      return;
    }
    if (await isWishlistMode(telegramId)) {
      await handleWishlistFileAttachment(ctx);
      return;
    }
    if (await isNotableDatesMode(telegramId)) {
      await handleNotableDatesDocument(ctx);
      return;
    }
  });

  // Text messages catch-all (priority order)
  bot.on("text", async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId == null) return next();

    // Skip commands
    if (ctx.message.text.startsWith("/")) return next();

    // Admin text input (waiting for user ID, tribe name, etc.)
    const consumed = await handleAdminTextInput(ctx);
    if (consumed) return;

    // Admin data text input (edit operations)
    const consumedData = await handleAdminDataTextInput(ctx);
    if (consumedData) return;

    // Neuro mode — AI chat
    if (await isNeuroMode(telegramId)) {
      await handleNeuroText(ctx);
      return;
    }

    // Goals mode — text input for creating goal sets/goals
    if (await isGoalsMode(telegramId)) {
      const handled = await handleGoalsText(ctx);
      if (handled) return;
      return next();
    }

    // Wishlist mode — text input for creating wishlists/items
    if (await isWishlistMode(telegramId)) {
      const handled = await handleWishlistText(ctx);
      if (handled) return;
      return next();
    }

    // Gandalf mode — text input for creating entries/categories
    if (await isGandalfMode(telegramId)) {
      const handled = await handleGandalfText(ctx);
      if (handled) return;
      return next();
    }

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

    // Digest mode — MTProto auth flow, then interactive rubric creation
    if (await isDigestMode(telegramId)) {
      const authHandled = await handleDigestAuthText(ctx);
      if (authHandled) return;
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
