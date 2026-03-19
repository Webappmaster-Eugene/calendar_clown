/**
 * Goals mode command handler.
 * Personal goal sets with progress tracking, sharing, and reminders.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { ensureUser, getUserByTelegramId, listTribeUsers } from "../expenses/repository.js";
import { isBootstrapAdmin, getUserMenuContext } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  createGoalSet,
  getGoalSetsByUser,
  getGoalSetById,
  deleteGoalSet,
  countGoalSetsByUser,
  updateGoalSet,
  createGoal,
  getGoalsBySet,
  toggleGoalCompleted,
  deleteGoal,
  getGoalSetProgress,
  addViewer,
  removeViewer,
  getViewersByGoalSet,
  getPublicGoalSetsForViewer,
  createReminders,
} from "../goals/repository.js";
import type { GoalSet } from "../goals/repository.js";
import {
  calculateDeadline,
  calculateReminderDates,
  formatPeriod,
  formatProgress,
  formatGoalText,
  formatDeadline,
} from "../goals/service.js";
import type { GoalPeriod } from "../goals/service.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { escapeMarkdown } from "../utils/markdown.js";

const log = createLogger("goals-mode");

const MAX_GOAL_SETS = 5;
const MAX_GOAL_TEXT_LENGTH = 500;

// ─── State ──────────────────────────────────────────────────────────────

interface GoalSetCreationState {
  step: "name" | "period";
  name?: string;
}

/** In-memory creation wizard states (telegramId → state). */
const creationStates = new Map<number, GoalSetCreationState>();

/** In-memory goal-adding states (telegramId → goalSetId). */
const goalAddingStates = new Map<number, number>();

// ─── Keyboard ───────────────────────────────────────────────────────────

function getGoalsKeyboard(isAdmin: boolean, hasTribe: boolean) {
  const rows: string[][] = [
    ["📋 Мои наборы целей", "➕ Новый набор целей"],
  ];
  if (hasTribe) {
    rows.push(["👀 Цели друзей"]);
  }
  rows.push(...getModeButtons(isAdmin));
  return Markup.keyboard(rows).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleGoalsCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("🎯 Цели недоступны (нет подключения к базе данных).");
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId)
  );

  await setUserMode(telegramId, "goals");
  await setModeMenuCommands(ctx, "goals");

  // Clear any pending states
  creationStates.delete(telegramId);
  goalAddingStates.delete(telegramId);

  const isAdmin = isBootstrapAdmin(telegramId);
  const hasTribe = dbUser.tribeId != null;

  await ctx.reply(
    "🎯 *Режим Хранитель целей активирован*\n\n" +
    "Создавайте наборы целей и отслеживайте прогресс.\n" +
    "До 5 наборов, цели текстом или голосом.",
    { parse_mode: "Markdown", ...getGoalsKeyboard(isAdmin, hasTribe) }
  );
}

// ─── My Goal Sets ───────────────────────────────────────────────────────

export async function handleMyGoalSetsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  const goalSets = await getGoalSetsByUser(dbUser.id);

  if (goalSets.length === 0) {
    await ctx.reply(
      "🎯 У вас пока нет наборов целей.\nНажмите «➕ Новый набор целей» чтобы создать."
    );
    return;
  }

  const buttons = goalSets.map((gs) => {
    const progress = formatProgress(gs.completedCount ?? 0, gs.totalCount ?? 0);
    return [
      Markup.button.callback(
        `${gs.emoji} ${gs.name} — ${progress}`,
        `goal_set:${gs.id}`
      ),
    ];
  });

  await ctx.reply(`🎯 *Мои наборы целей (${goalSets.length}):*`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─── New Goal Set (wizard start) ────────────────────────────────────────

export async function handleNewGoalSetButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  const count = await countGoalSetsByUser(dbUser.id);
  if (count >= MAX_GOAL_SETS) {
    await ctx.reply(`🎯 Максимум ${MAX_GOAL_SETS} наборов целей. Удалите один, чтобы создать новый.`);
    return;
  }

  creationStates.set(telegramId, { step: "name" });
  goalAddingStates.delete(telegramId);

  await ctx.reply("🎯 Введите название набора целей:");
}

// ─── Shared Goals ───────────────────────────────────────────────────────

export async function handleSharedGoalsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  const sharedSets = await getPublicGoalSetsForViewer(dbUser.id);

  if (sharedSets.length === 0) {
    await ctx.reply("👀 Пока никто не поделился с вами своими целями.");
    return;
  }

  const lines = sharedSets.map((gs) => {
    const progress = formatProgress(gs.completedCount ?? 0, gs.totalCount ?? 0);
    return `${gs.emoji} *${escapeMarkdown(gs.ownerName)}* — ${escapeMarkdown(gs.name)}\n${progress}`;
  });

  // Show as inline buttons for read-only viewing
  const buttons = sharedSets.map((gs) => [
    Markup.button.callback(
      `${gs.emoji} ${gs.ownerName}: ${gs.name}`,
      `goal_set_view:${gs.id}`
    ),
  ]);

  await ctx.reply(
    `👀 *Цели друзей (${sharedSets.length}):*\n\n${lines.join("\n\n")}`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }
  );
}

// ─── Goal Set Callbacks ─────────────────────────────────────────────────

export async function handleGoalSetCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  // goal_set:<id> — view set
  if (data.startsWith("goal_set:")) {
    const setId = parseInt(data.split(":")[1], 10);
    await showGoalSet(ctx, setId, dbUser.id);
    return;
  }

  // goal_set_del:<id> — delete set
  if (data.startsWith("goal_set_del:")) {
    const setId = parseInt(data.split(":")[1], 10);
    const deleted = await deleteGoalSet(setId, dbUser.id);
    if (deleted) {
      await ctx.editMessageText("🗑 Набор целей удалён.");
    } else {
      await ctx.editMessageText("Не удалось удалить набор.");
    }
    return;
  }

  // goal_set_vis:<id> — toggle visibility
  if (data.startsWith("goal_set_vis:")) {
    const setId = parseInt(data.split(":")[1], 10);
    const gs = await getGoalSetById(setId);
    if (!gs || gs.userId !== dbUser.id) return;

    if (!dbUser.tribeId) {
      await ctx.answerCbQuery("Видимость доступна только участникам трайба");
      return;
    }

    const newVis = gs.visibility === "private" ? "public" : "private";
    await updateGoalSet(setId, dbUser.id, { visibility: newVis });

    if (newVis === "public" && dbUser.tribeId) {
      // Show viewer selection
      await showViewerSelection(ctx, setId, dbUser.id, dbUser.tribeId);
    } else {
      await showGoalSet(ctx, setId, dbUser.id);
    }
    return;
  }

  // goal_set_add:<id> — enter goal adding mode
  if (data.startsWith("goal_set_add:")) {
    const setId = parseInt(data.split(":")[1], 10);
    const gs = await getGoalSetById(setId);
    if (!gs || gs.userId !== dbUser.id) return;

    goalAddingStates.set(telegramId, setId);
    creationStates.delete(telegramId);

    await ctx.editMessageText(
      `🎯 *${escapeMarkdown(gs.name)}*\n\nОтправляйте цели текстом или голосом (по одной).\nНажмите «✅ Готово» когда закончите.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Готово", `goal_set_done:${setId}`)],
        ]),
      }
    );
    return;
  }

  // goal_set_done:<id> — finish adding goals
  if (data.startsWith("goal_set_done:")) {
    const setId = parseInt(data.split(":")[1], 10);
    goalAddingStates.delete(telegramId);
    await showGoalSet(ctx, setId, dbUser.id);
    return;
  }

  // goal_set_viewers:<id> — manage viewers
  if (data.startsWith("goal_set_viewers:")) {
    const setId = parseInt(data.split(":")[1], 10);
    const gs = await getGoalSetById(setId);
    if (!gs || gs.userId !== dbUser.id || !dbUser.tribeId) return;

    await showViewerSelection(ctx, setId, dbUser.id, dbUser.tribeId);
    return;
  }

  // goal_set_view:<id> — read-only view (shared goals)
  if (data.startsWith("goal_set_view:")) {
    const setId = parseInt(data.split(":")[1], 10);
    await showGoalSetReadOnly(ctx, setId);
    return;
  }
}

// ─── Goal Callbacks ─────────────────────────────────────────────────────

export async function handleGoalCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  // goal_done:<id> — toggle completion
  if (data.startsWith("goal_done:")) {
    const goalId = parseInt(data.split(":")[1], 10);
    const goal = await toggleGoalCompleted(goalId);
    if (!goal) return;

    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return;

    // Refresh the goal set view
    await showGoalSet(ctx, goal.goalSetId, dbUser.id);
    return;
  }

  // goal_del:<id>:<setId> — delete goal
  if (data.startsWith("goal_del:")) {
    const parts = data.split(":");
    const goalId = parseInt(parts[1], 10);
    const setId = parseInt(parts[2], 10);
    await deleteGoal(goalId);

    const dbUser = await getUserByTelegramId(telegramId);
    if (!dbUser) return;

    await showGoalSet(ctx, setId, dbUser.id);
    return;
  }
}

// ─── Period Callback ────────────────────────────────────────────────────

export async function handleGoalPeriodCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const period = data.split(":")[1] as GoalPeriod;
  if (!["current", "month", "year", "5years"].includes(period)) return;

  const state = creationStates.get(telegramId);
  if (!state || state.step !== "period" || !state.name) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const now = new Date();
  const deadline = calculateDeadline(period, now);

  let goalSet: GoalSet;
  try {
    goalSet = await createGoalSet(dbUser.id, state.name, period, deadline);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("goal_sets_user_name_key")) {
      await ctx.editMessageText("Набор с таким именем уже существует. Попробуйте другое название.");
      creationStates.delete(telegramId);
      return;
    }
    throw err;
  }

  // Create reminders if there's a deadline
  const reminderDates = calculateReminderDates(now, deadline);
  if (reminderDates.length > 0) {
    await createReminders(goalSet.id, reminderDates);
  }

  creationStates.delete(telegramId);
  goalAddingStates.set(telegramId, goalSet.id);

  const deadlineText = formatDeadline(deadline);
  const periodText = formatPeriod(period);

  await ctx.editMessageText(
    `🎯 Набор *${escapeMarkdown(goalSet.name)}* создан!\n` +
    `Период: ${periodText}\n` +
    (deadlineText ? `${deadlineText}\n` : "") +
    (reminderDates.length > 0 ? `📬 Настроено ${reminderDates.length} напоминания\n` : "") +
    `\nОтправляйте цели текстом или голосом (по одной).\nНажмите «✅ Готово» когда закончите.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Готово", `goal_set_done:${goalSet.id}`)],
      ]),
    }
  );
}

// ─── Viewer Callbacks ───────────────────────────────────────────────────

export async function handleGoalViewerCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser || !dbUser.tribeId) return;

  // goal_viewer_add:<setId>:<userId>
  if (data.startsWith("goal_viewer_add:")) {
    const parts = data.split(":");
    const setId = parseInt(parts[1], 10);
    const viewerUserId = parseInt(parts[2], 10);
    await addViewer(setId, viewerUserId);
    await showViewerSelection(ctx, setId, dbUser.id, dbUser.tribeId);
    return;
  }

  // goal_viewer_del:<setId>:<userId>
  if (data.startsWith("goal_viewer_del:")) {
    const parts = data.split(":");
    const setId = parseInt(parts[1], 10);
    const viewerUserId = parseInt(parts[2], 10);
    await removeViewer(setId, viewerUserId);
    await showViewerSelection(ctx, setId, dbUser.id, dbUser.tribeId);
    return;
  }

  // goal_viewer_done:<setId>
  if (data.startsWith("goal_viewer_done:")) {
    const setId = parseInt(data.split(":")[1], 10);
    await showGoalSet(ctx, setId, dbUser.id);
    return;
  }
}

// ─── Page Callback ──────────────────────────────────────────────────────

export async function handleGoalsPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  // goal_page:<setId>:<offset>
  const parts = data.split(":");
  const setId = parseInt(parts[1], 10);
  const offset = parseInt(parts[2], 10);

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  await showGoalSet(ctx, setId, dbUser.id, offset);
}

// ─── Text Handler ───────────────────────────────────────────────────────

/** Handle text input in goals mode. Returns true if consumed. */
export async function handleGoalsText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text;

  // Creation wizard — name step
  const state = creationStates.get(telegramId);
  if (state?.step === "name") {
    const name = text.trim();
    if (name.length === 0 || name.length > 100) {
      await ctx.reply("Название должно быть от 1 до 100 символов.");
      return true;
    }

    state.name = name;
    state.step = "period";
    creationStates.set(telegramId, state);

    await ctx.reply(
      `🎯 Набор «${escapeMarkdown(name)}»\n\nВыберите период:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("Текущие", "goal_period:current"),
            Markup.button.callback("На месяц", "goal_period:month"),
          ],
          [
            Markup.button.callback("На год", "goal_period:year"),
            Markup.button.callback("На 5 лет", "goal_period:5years"),
          ],
        ]),
      }
    );
    return true;
  }

  // Goal adding mode — add goal text
  const goalSetId = goalAddingStates.get(telegramId);
  if (goalSetId != null) {
    const goalText = text.trim();
    if (goalText.length === 0) return true;

    if (goalText.length > MAX_GOAL_TEXT_LENGTH) {
      await ctx.reply(`Текст цели слишком длинный (максимум ${MAX_GOAL_TEXT_LENGTH} символов).`);
      return true;
    }

    const goal = await createGoal(goalSetId, goalText, "text");
    const progress = await getGoalSetProgress(goalSetId);

    await ctx.reply(
      `✅ Цель добавлена (${progress.total})\n• ${escapeMarkdown(goalText)}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
}

// ─── Voice Handler ──────────────────────────────────────────────────────

/** Handle voice transcript in goals mode. */
export async function handleGoalsVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const goalSetId = goalAddingStates.get(telegramId);
  if (goalSetId == null) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "🎯 Голосовые цели доступны только при добавлении целей в набор.\nОткройте набор и нажмите «➕ Добавить цель»."
    );
    return;
  }

  const goalText = transcript.trim();
  if (goalText.length === 0) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      "Не удалось распознать текст цели."
    );
    return;
  }

  if (goalText.length > MAX_GOAL_TEXT_LENGTH) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `Текст цели слишком длинный (максимум ${MAX_GOAL_TEXT_LENGTH} символов).`
    );
    return;
  }

  const goal = await createGoal(goalSetId, goalText, "voice");
  const progress = await getGoalSetProgress(goalSetId);

  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    statusMsgId,
    undefined,
    `🎤 ✅ Цель добавлена (${progress.total})\n• ${escapeMarkdown(goalText)}`,
    { parse_mode: "Markdown" }
  );
}

// ─── Private helpers ────────────────────────────────────────────────────

const GOALS_PAGE_SIZE = 10;

async function showGoalSet(ctx: Context, goalSetId: number, userId: number, offset: number = 0): Promise<void> {
  const gs = await getGoalSetById(goalSetId);
  if (!gs) {
    try { await ctx.editMessageText("Набор целей не найден."); } catch { /* new message */ }
    return;
  }

  const isOwner = gs.userId === userId;
  const goals = await getGoalsBySet(goalSetId);
  const progress = formatProgress(gs.completedCount ?? 0, gs.totalCount ?? 0);
  const deadlineText = formatDeadline(gs.deadline);
  const visIcon = gs.visibility === "public" ? "🌐" : "🔒";

  const header =
    `${gs.emoji} *${escapeMarkdown(gs.name)}*\n` +
    `Период: ${formatPeriod(gs.period)}\n` +
    (deadlineText ? `${deadlineText}\n` : "") +
    `Прогресс: ${progress}\n` +
    `Видимость: ${visIcon}`;

  // Goals list (paginated)
  const pageGoals = goals.slice(offset, offset + GOALS_PAGE_SIZE);
  const goalsText = pageGoals.length > 0
    ? "\n\n" + pageGoals.map((g) => formatGoalText(escapeMarkdown(g.text), g.isCompleted)).join("\n")
    : "\n\n_Целей пока нет_";

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  if (isOwner) {
    // Toggle completion buttons for incomplete goals
    const incomplete = pageGoals.filter((g) => !g.isCompleted);
    if (incomplete.length > 0) {
      for (const g of incomplete) {
        const label = g.text.length > 30 ? g.text.slice(0, 30) + "…" : g.text;
        buttons.push([
          Markup.button.callback(`✅ ${label}`, `goal_done:${g.id}`),
          Markup.button.callback("🗑", `goal_del:${g.id}:${goalSetId}`),
        ]);
      }
    }

    // Completed goals — allow unchecking
    const completed = pageGoals.filter((g) => g.isCompleted);
    if (completed.length > 0) {
      for (const g of completed) {
        const label = g.text.length > 30 ? g.text.slice(0, 30) + "…" : g.text;
        buttons.push([
          Markup.button.callback(`↩️ ${label}`, `goal_done:${g.id}`),
          Markup.button.callback("🗑", `goal_del:${g.id}:${goalSetId}`),
        ]);
      }
    }

    // Pagination
    const navRow: ReturnType<typeof Markup.button.callback>[] = [];
    if (offset > 0) {
      navRow.push(Markup.button.callback("⬅️", `goal_page:${goalSetId}:${Math.max(0, offset - GOALS_PAGE_SIZE)}`));
    }
    if (offset + GOALS_PAGE_SIZE < goals.length) {
      navRow.push(Markup.button.callback("➡️", `goal_page:${goalSetId}:${offset + GOALS_PAGE_SIZE}`));
    }
    if (navRow.length > 0) buttons.push(navRow);

    // Action buttons
    buttons.push([
      Markup.button.callback("➕ Добавить цель", `goal_set_add:${goalSetId}`),
      Markup.button.callback(`👁 ${visIcon}`, `goal_set_vis:${goalSetId}`),
    ]);
    if (gs.visibility === "public") {
      buttons.push([
        Markup.button.callback("👥 Зрители", `goal_set_viewers:${goalSetId}`),
      ]);
    }
    buttons.push([
      Markup.button.callback("🗑 Удалить набор", `goal_set_del:${goalSetId}`),
    ]);
  }

  const text = header + goalsText;

  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

async function showGoalSetReadOnly(ctx: Context, goalSetId: number): Promise<void> {
  const gs = await getGoalSetById(goalSetId);
  if (!gs) {
    try { await ctx.editMessageText("Набор целей не найден."); } catch { /* ok */ }
    return;
  }

  const goals = await getGoalsBySet(goalSetId);
  const progress = formatProgress(gs.completedCount ?? 0, gs.totalCount ?? 0);
  const deadlineText = formatDeadline(gs.deadline);

  const goalsText = goals.length > 0
    ? goals.map((g) => formatGoalText(escapeMarkdown(g.text), g.isCompleted)).join("\n")
    : "_Целей пока нет_";

  const text =
    `${gs.emoji} *${escapeMarkdown(gs.name)}*\n` +
    `Прогресс: ${progress}\n` +
    (deadlineText ? `${deadlineText}\n` : "") +
    `\n${goalsText}`;

  try {
    await ctx.editMessageText(text, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(text, { parse_mode: "Markdown" });
  }
}

async function showViewerSelection(
  ctx: Context,
  goalSetId: number,
  ownerUserId: number,
  tribeId: number
): Promise<void> {
  const tribeMembers = await listTribeUsers(tribeId);
  const currentViewers = await getViewersByGoalSet(goalSetId);
  const viewerIds = new Set(currentViewers.map((v) => v.viewerUserId));

  const buttons = tribeMembers
    .filter((m) => m.id !== ownerUserId)
    .map((m) => {
      const isViewer = viewerIds.has(m.id);
      const icon = isViewer ? "✅" : "◻️";
      const action = isViewer
        ? `goal_viewer_del:${goalSetId}:${m.id}`
        : `goal_viewer_add:${goalSetId}:${m.id}`;
      return [Markup.button.callback(`${icon} ${m.firstName}`, action)];
    });

  buttons.push([Markup.button.callback("💾 Готово", `goal_viewer_done:${goalSetId}`)]);

  const text = "👥 *Выберите, кто может видеть этот набор:*";

  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  }
}
