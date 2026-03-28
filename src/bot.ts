import type http from "node:http";
import { Telegraf, type Context } from "telegraf";
import { handleStart, handleHelp } from "./commands/start.js";
import { handleAuth } from "./commands/auth.js";
import { handleNew, handleCalendarText } from "./commands/createEvent.js";
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
import { handleSummaryCallback } from "./commands/adminSummary.js";
import { handleTranscribeCommand, handleTranscribeHistoryButton, handleClearQueueButton, handleQueueStatusButton, handleTranscribeHistoryCallback, handleTranscribeFullCallback, handleTranscribeDeleteCallback } from "./commands/transcribeMode.js";
import { handleAdminDataCallback, handleAdminDataTextInput } from "./commands/adminData.js";
import { handleBulkCallback } from "./utils/bulkSelect.js";
import { handleDigestCommand, handleRubricsButton, handleDigestNowButton, handleCreateRubricButton, handleDigestText, handleFolderImportButton, handleDigestFolderCallback, handleDigestFolderToCallback, handleRubricViewCallback, handleRubricToggleCallback, handleRubricDeleteCallback, handleRubricDeleteConfirmCallback, handleRubricChannelsCallback, handleChannelRemoveCallback, handleChannelAddCallback, handleRubricListCallback, handleRubricEditCallback, handleRubricEditNameCallback, handleRubricEditDescCallback, handleRubricEditEmojiCallback, handleRubricFolderImportCallback, handleRubricFolderImportToCallback } from "./commands/digestMode.js";
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
  handleGandalfCommand,
  handleGandalfCategoriesButton,
  handleGandalfNewEntryButton,
  handleGandalfAllEntriesButton,
  handleGandalfStatsButton,
  handleGandalfImportantButton,
  handleGandalfUrgentButton,
  handleGandalfNewCatCallback,
  handleGandalfViewCatCallback,
  handleGandalfDelCatCallback,
  handleGandalfEntryCatCallback,
  handleGandalfPageCallback,
  handleGandalfEntryActionCallback,
  handleGandalfFilesCallback,
  handleGandalfOptionalCallback,
  handleGandalfStatsCallback,
  handleGandalfFlagCallback,
  handleGandalfVisibilityCallback,
  handleGandalfVisibilitySelectCallback,
  handleGandalfMoveCallback,
  handleGandalfMoveToCallback,
  handleGandalfText,
  handleGandalfFileAttachment,
  handleGandalfEditCallback,
  handleGandalfClearMenuCallback,
  handleGandalfClearFieldCallback,
} from "./commands/gandalfMode.js";
import {
  handleNeuroCommand,
  handleNeuroText,
  handleNeuroClearButton,
  handleNeuroPhoto,
  handleNeuroDocument,
  handleNeuroDialogsButton,
  handleNeuroNewDialogButton,
  handleNeuroDialogSwitch,
  handleNeuroDialogDeleteMode,
  handleNeuroDialogDelete,
  handleProviderToggle,
} from "./commands/chatMode.js";
import { cancelBatch } from "./chat/messageBatcher.js";
import { getUserByTelegramId as getDbUser } from "./expenses/repository.js";
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
import {
  handleOsintCommand,
  handleOsintText,
  handleNewSearchButton,
  handleHistoryButton,
  handleHistoryPageCallback,
  handleHistoryFilterCallback,
  handleHistorySearchCallback,
  handleViewSearchCallback,
  handleOsintConfirmCallback,
  handleOsintReenterCallback,
  handleOsintCancelCallback,
} from "./commands/osintMode.js";
import { accessControlMiddleware, getUserMenuContext, canAccessMode } from "./middleware/auth.js";
import { createLogger } from "./utils/logger.js";
import { isExpenseMode, isBroadcastMode, isNotableDatesMode, isTranscribeMode, isDigestMode, isGandalfMode, isNeuroMode, isWishlistMode, isGoalsMode, isRemindersMode, isOsintMode, isSummarizerMode, isBloggerMode, isCalendarMode, isSimplifierMode, isTasksMode } from "./middleware/userMode.js";
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
import {
  handleRemindersCommand,
  handleMyRemindersButton,
  handleNewReminderButton,
  handleTribeRemindersButton,
  handleReminderViewCallback,
  handleReminderActionCallback,
  handleReminderEditCallback,
  handleReminderTribeCallback,
  handleRemindersText,
} from "./commands/remindersMode.js";
import {
  handleSummarizerCommand,
  handleMyWorkplacesButton,
  handleNewWorkplaceButton,
  handleSumCallback,
  handleSummarizerText,
} from "./commands/summarizerMode.js";
import {
  handleBloggerCommand,
  handleMyChannelsButton,
  handleNewChannelButton,
  handleMyPostsButton,
  handleBlogCallback,
  handleBloggerText,
} from "./commands/bloggerMode.js";
import {
  handleTasksCommand,
  handleMyProjectsButton,
  handleNewProjectButton,
  handleTasksHistoryButton,
  handleTaskWorkCallback,
  handleTaskItemCallback,
  handleTasksPageCallback,
  handleTasksText,
} from "./commands/tasksMode.js";
import {
  handleSimplifierCommand,
  handleSimplifierText,
  handleSimplifyButton,
  handleSimplifierClearButton,
  handleSimplifierHistoryButton,
  handleSimplifierHistoryCallback,
  handleSimplifierFullCallback,
  handleSimplifierDeleteCallback,
} from "./commands/simplifierMode.js";

export function createBot(token: string, telegramAgent?: http.Agent): Telegraf {
  const log = createLogger("bot");
  const bot = new Telegraf(token, {
    telegram: telegramAgent ? { agent: telegramAgent } : undefined,
    handlerTimeout: 300_000, // 5 min — default 90s is too short for slow proxy downloads
  });

  // Global error handler — prevent unhandled errors from crashing the process
  bot.catch((err, ctx) => {
    const userId = ctx.from?.id ?? "unknown";
    log.error(`Unhandled error for user ${userId}:`, err);
    try {
      ctx.reply("Произошла ошибка при обработке запроса. Попробуйте ещё раз.").catch(() => {});
    } catch {
      // ctx.reply itself can throw synchronously if context is broken
    }
  });

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
  bot.command("gandalf", handleGandalfCommand);
  bot.command("wishlist", handleWishlistCommand);
  bot.command("goals", handleGoalsCommand);
  bot.command("reminders", handleRemindersCommand);
  bot.command("osint", handleOsintCommand);
  bot.command("summarizer", handleSummarizerCommand);
  bot.command("blogger", handleBloggerCommand);
  bot.command("simplifier", handleSimplifierCommand);
  bot.command("neuro", handleNeuroCommand);
  bot.command("tasks", handleTasksCommand);

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

  // Simplifier callbacks
  bot.action(/^simp_hist:/, handleSimplifierHistoryCallback);
  bot.action(/^simp_full:/, handleSimplifierFullCallback);
  bot.action(/^simp_del:/, handleSimplifierDeleteCallback);
  bot.action(/^simp_del_yes:/, handleSimplifierDeleteCallback);

  // Admin summary callbacks
  bot.action(/^summary:/, handleSummaryCallback);

  // Admin data management callbacks
  bot.action(/^adm_/, handleAdminDataCallback);

  // Bulk selection callbacks
  bot.action(/^bulk:/, handleBulkCallback);

  // Digest rubric inline callbacks
  bot.action("drub_back", handleRubricListCallback);
  bot.action(/^drub_view:/, handleRubricViewCallback);
  bot.action(/^drub_pause:/, handleRubricToggleCallback);
  bot.action(/^drub_resume:/, handleRubricToggleCallback);
  bot.action(/^drub_del:\d+$/, handleRubricDeleteCallback);
  bot.action(/^drub_del_yes:\d+$/, handleRubricDeleteConfirmCallback);
  bot.action(/^drub_ch:/, handleRubricChannelsCallback);
  bot.action(/^drub_ch_rm:/, handleChannelRemoveCallback);
  bot.action(/^drub_ch_add:/, handleChannelAddCallback);

  // Digest rubric edit callbacks
  bot.action(/^drub_edit:\d+$/, handleRubricEditCallback);
  bot.action(/^drub_edit_name:\d+$/, handleRubricEditNameCallback);
  bot.action(/^drub_edit_desc:\d+$/, handleRubricEditDescCallback);
  bot.action(/^drub_edit_emoji:\d+$/, handleRubricEditEmojiCallback);
  bot.action(/^drub_import:\d+$/, handleRubricFolderImportCallback);
  bot.action(/^drub_import_folder:\d+:\d+$/, handleRubricFolderImportToCallback);

  // Digest folder import callbacks
  bot.action(/^digest_folder:/, handleDigestFolderCallback);
  bot.action(/^digest_folder_to:/, handleDigestFolderToCallback);

  // Gandalf (База знаний) callbacks
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
  bot.action(/^gandalf_imp:/, handleGandalfFlagCallback);
  bot.action(/^gandalf_urg:/, handleGandalfFlagCallback);
  bot.action(/^gandalf_vis_toggle:/, handleGandalfVisibilityCallback);
  bot.action(/^gandalf_vis:/, handleGandalfVisibilitySelectCallback);
  bot.action(/^gandalf_move:/, handleGandalfMoveCallback);
  bot.action(/^gandalf_move_to:/, handleGandalfMoveToCallback);
  bot.action(/^gandalf_edit_title:/, handleGandalfEditCallback);
  bot.action(/^gandalf_edit_price:/, handleGandalfEditCallback);
  bot.action(/^gandalf_edit_date:/, handleGandalfEditCallback);
  bot.action(/^gandalf_edit_info:/, handleGandalfEditCallback);
  bot.action(/^gandalf_clear_menu:/, handleGandalfClearMenuCallback);
  bot.action(/^gandalf_clear:/, handleGandalfClearFieldCallback);

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

  // Reminders callbacks
  bot.action(/^rem_view:/, handleReminderViewCallback);
  bot.action(/^rem_pause:/, handleReminderActionCallback);
  bot.action(/^rem_del:/, handleReminderActionCallback);
  bot.action(/^rem_confirm:/, handleReminderActionCallback);
  bot.action(/^rem_cancel_create:/, handleReminderActionCallback);
  bot.action(/^rem_edit:/, handleReminderEditCallback);
  bot.action(/^rem_edit_text:/, handleReminderEditCallback);
  bot.action(/^rem_edit_times:/, handleReminderEditCallback);
  bot.action(/^rem_edit_days:/, handleReminderEditCallback);
  bot.action(/^rem_edit_end:/, handleReminderEditCallback);
  bot.action(/^rem_tribe_user:/, handleReminderTribeCallback);
  bot.action(/^rem_tribe_view:/, handleReminderTribeCallback);
  bot.action(/^rem_sub:/, handleReminderTribeCallback);
  bot.action(/^rem_unsub:/, handleReminderTribeCallback);

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

  // Tasks callbacks
  bot.action(/^tw_view:/, handleTaskWorkCallback);
  bot.action(/^tw_add:/, handleTaskWorkCallback);
  bot.action(/^tw_del:/, handleTaskWorkCallback);
  bot.action(/^tw_del_yes:/, handleTaskWorkCallback);
  bot.action(/^tw_archive:/, handleTaskWorkCallback);
  bot.action(/^tw_hist:/, handleTaskWorkCallback);
  bot.action(/^tw_voice_work:/, handleTaskWorkCallback);
  bot.action(/^ti_done:/, handleTaskItemCallback);
  bot.action(/^ti_del:/, handleTaskItemCallback);
  bot.action(/^t_page:/, handleTasksPageCallback);

  // OSINT callbacks
  bot.action(/^osint_confirm$/, handleOsintConfirmCallback);
  bot.action(/^osint_reenter$/, handleOsintReenterCallback);
  bot.action(/^osint_cancel$/, handleOsintCancelCallback);
  bot.action(/^osint_hist:/, handleHistoryPageCallback);
  bot.action(/^osint_hist_filter:/, handleHistoryFilterCallback);
  bot.action(/^osint_hist_search$/, handleHistorySearchCallback);
  bot.action(/^osint_view:/, handleViewSearchCallback);

  // Summarizer callbacks
  bot.action(/^sum_/, handleSumCallback);

  // Blogger callbacks
  bot.action(/^blog_/, handleBlogCallback);

  // Neuro dialog callbacks
  bot.action(/^neuro_dlg:\d+$/, handleNeuroDialogSwitch);
  bot.action(/^neuro_dlg_del:\d+$/, handleNeuroDialogDelete);
  bot.action("neuro_dlg_del_mode", handleNeuroDialogDeleteMode);

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
    await ctx.answerCbQuery("🎙️ Транскрибация");
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
    await ctx.answerCbQuery("⚙️ Админка");
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
  bot.action("mode:gandalf", async (ctx) => {
    await ctx.answerCbQuery("🧙 База знаний");
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
  bot.action("mode:simplifier", async (ctx) => {
    await ctx.answerCbQuery("🧹 Упрощатель");
    await handleSimplifierCommand(ctx);
  });
  bot.action("mode:neuro", async (ctx) => {
    await ctx.answerCbQuery("🧠 Нейро");
    await handleNeuroCommand(ctx);
  });
  bot.action("mode:goals", async (ctx) => {
    await ctx.answerCbQuery("🎯 Цели");
    await handleGoalsCommand(ctx);
  });
  bot.action("mode:reminders", async (ctx) => {
    await ctx.answerCbQuery("⏰ Напоминания");
    await handleRemindersCommand(ctx);
  });
  bot.action("mode:osint", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("osint", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("🔍 OSINT");
    await handleOsintCommand(ctx);
  });
  bot.action("mode:summarizer", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("summarizer", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("📋 Резюме");
    await handleSummarizerCommand(ctx);
  });
  bot.action("mode:blogger", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("blogger", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("✍️ Блогер");
    await handleBloggerCommand(ctx);
  });
  bot.action("mode:tasks", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid) {
      const mc = await getUserMenuContext(tid);
      if (mc && !canAccessMode("tasks", mc)) {
        await ctx.answerCbQuery("Требуется трайб");
        return;
      }
    }
    await ctx.answerCbQuery("✅ Задачи");
    await handleTasksCommand(ctx);
  });
  bot.action("noop", async (ctx) => { await ctx.answerCbQuery(); });

  // ─── Voice ──────────────────────────────────────────────────────────

  bot.on("voice", handleVoice);

  // ─── Mode switch buttons ──────────────────────────────────────────

  bot.hears("💰 Расходы", handleExpensesCommand);
  bot.hears("📅 Календарь", handleCalendarCommand);
  bot.hears("🎙️ Транскрибация", handleTranscribeCommand);
  bot.hears("📰 Дайджест", handleDigestCommand);
  bot.hears("📢 Рассылка", handleBroadcastCommand);
  bot.hears("⚙️ Админка", handleAdminCommand);
  bot.hears("🎂 Даты", handleNotableDatesCommand);
  bot.hears("🧙 База знаний", handleGandalfCommand);
  bot.hears("🎁 Вишлист", handleWishlistCommand);
  bot.hears("🧠 Нейро", handleNeuroCommand);
  bot.hears("🎯 Цели", handleGoalsCommand);
  bot.hears("⏰ Напоминания", handleRemindersCommand);
  bot.hears("🔍 OSINT", handleOsintCommand);
  bot.hears("📋 Резюме", handleSummarizerCommand);
  bot.hears("✍️ Блогер", handleBloggerCommand);
  bot.hears("🧹 Упрощатель", handleSimplifierCommand);
  bot.hears("✅ Задачи", handleTasksCommand);
  bot.hears("🏠 Главное меню", handleModeCommand);

  // Backward compatibility — old keyboard labels (for users with cached keyboards)
  bot.hears("🎙 Транскрибатор", handleTranscribeCommand);
  bot.hears("📢 Царская почта", handleBroadcastCommand);
  bot.hears("👑 Управление", handleAdminCommand);
  bot.hears("🎉 Даты", handleNotableDatesCommand);
  bot.hears("📚 База знаний", handleGandalfCommand);
  bot.hears("📝 Саммаризатор", handleSummarizerCommand);

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

  // Simplifier mode buttons
  bot.hears("🧹 Упростить", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isSimplifierMode(tid)) {
      await handleSimplifyButton(ctx);
    }
  });
  bot.hears("🗑 Очистить буфер", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isSimplifierMode(tid)) {
      await handleSimplifierClearButton(ctx);
    }
  });

  // Transcribe mode buttons
  bot.hears("📋 История", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isTranscribeMode(tid)) {
      await handleTranscribeHistoryButton(ctx);
    }
    if (tid != null && await isSimplifierMode(tid)) {
      await handleSimplifierHistoryButton(ctx);
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

  // Wishlist mode buttons
  bot.hears("🎁 Мои вишлисты", handleMyWishlistsButton);
  bot.hears("👀 Вишлисты семьи", handleTribeWishlistsButton);
  bot.hears("➕ Новый вишлист", handleNewWishlistButton);

  // Gandalf (База знаний) mode buttons
  bot.hears("📦 Категории", handleGandalfCategoriesButton);
  bot.hears("➕ Новая запись", handleGandalfNewEntryButton);
  bot.hears("📊 Статистика", handleGandalfStatsButton);
  bot.hears("📋 Все записи", handleGandalfAllEntriesButton);
  bot.hears("⭐ Важное", handleGandalfImportantButton);
  bot.hears("🔥 Срочное", handleGandalfUrgentButton);

  // Goals mode buttons
  bot.hears("📋 Мои наборы целей", handleMyGoalSetsButton);
  bot.hears("➕ Новый набор целей", handleNewGoalSetButton);
  bot.hears("👀 Цели друзей", handleSharedGoalsButton);

  // Tasks mode buttons
  bot.hears("📋 Мои проекты", handleMyProjectsButton);
  bot.hears("➕ Новый проект", handleNewProjectButton);
  bot.hears("📜 История выполнения", handleTasksHistoryButton);

  // Reminders mode buttons
  bot.hears("📋 Мои напоминания", handleMyRemindersButton);
  bot.hears("➕ Новое напоминание", handleNewReminderButton);
  bot.hears("👀 Напоминания семьи", handleTribeRemindersButton);

  // OSINT mode buttons
  bot.hears("🔍 Новый поиск", handleNewSearchButton);
  bot.hears("📋 История поисков", handleHistoryButton);

  // Summarizer mode buttons
  bot.hears("📋 Мои места работы", handleMyWorkplacesButton);
  bot.hears("➕ Новое место", handleNewWorkplaceButton);

  // Blogger mode buttons
  bot.hears("📝 Мои каналы", handleMyChannelsButton);
  bot.hears("➕ Новый канал", handleNewChannelButton);
  bot.hears("📄 Мои посты", handleMyPostsButton);

  // Neuro mode buttons
  bot.hears("💬 Диалоги", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isNeuroMode(tid)) {
      const dbUser = await getDbUser(tid);
      if (dbUser) cancelBatch(dbUser.id);
      await handleNeuroDialogsButton(ctx);
    }
  });
  bot.hears("➕ Новый диалог", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isNeuroMode(tid)) {
      const dbUser = await getDbUser(tid);
      if (dbUser) cancelBatch(dbUser.id);
      await handleNeuroNewDialogButton(ctx);
    }
  });
  bot.hears("🗑 Очистить историю", async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isNeuroMode(tid)) {
      const dbUser = await getDbUser(tid);
      if (dbUser) cancelBatch(dbUser.id);
      await handleNeuroClearButton(ctx);
    }
  });
  bot.hears(/^(🆓 Free|💎 Paid)$/, async (ctx) => {
    const tid = ctx.from?.id;
    if (tid != null && await isNeuroMode(tid)) {
      await handleProviderToggle(ctx);
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
    if (await isNeuroMode(telegramId)) {
      await handleNeuroPhoto(ctx);
      return;
    }
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
    if (await isNeuroMode(telegramId)) {
      await handleNeuroDocument(ctx);
      return;
    }
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

    // Tasks mode — text input for creating works/tasks
    if (await isTasksMode(telegramId)) {
      const handled = await handleTasksText(ctx);
      if (handled) return;
      return next();
    }

    // Reminders mode — text input for creating/editing reminders
    if (await isRemindersMode(telegramId)) {
      const handled = await handleRemindersText(ctx);
      if (handled) return;
      return next();
    }

    // Wishlist mode — text input for creating wishlists/items
    if (await isWishlistMode(telegramId)) {
      const handled = await handleWishlistText(ctx);
      if (handled) return;
      return next();
    }

    // Gandalf (База знаний) mode — text input for creating entries/categories
    if (await isGandalfMode(telegramId)) {
      const handled = await handleGandalfText(ctx);
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

    // OSINT mode — search from text
    if (await isOsintMode(telegramId)) {
      const handled = await handleOsintText(ctx);
      if (handled) return;
      return next();
    }

    // Summarizer mode — text input for workplaces/achievements
    if (await isSummarizerMode(telegramId)) {
      const handled = await handleSummarizerText(ctx);
      if (handled) return;
      return next();
    }

    // Blogger mode — text input for channels/posts/sources
    if (await isBloggerMode(telegramId)) {
      const handled = await handleBloggerText(ctx);
      if (handled) return;
      return next();
    }

    // Simplifier mode — accumulate text in buffer
    if (await isSimplifierMode(telegramId)) {
      const handled = await handleSimplifierText(ctx);
      if (handled) return;
      return next();
    }

    // Broadcast mode — send text to all tribe members
    if (await isBroadcastMode(telegramId)) {
      await handleBroadcastText(ctx);
      return;
    }

    // Calendar mode — text input for creating events without /new prefix
    if (await isCalendarMode(telegramId)) {
      await handleCalendarText(ctx);
      return;
    }

    // Only process in expense mode
    if (!await isExpenseMode(telegramId)) return next();

    await handleExpenseText(ctx);
  });

  return bot;
}
