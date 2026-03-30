/**
 * Tasks mode command handler.
 * Task tracker with projects, deadlines, and automatic reminders.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  getUserWorks,
  getWorkWithTasks,
  createNewWork,
  removeWork,
  addTask,
  toggleTask,
  removeTask,
  getCompletedHistory,
  findWorkByName,
  updateText,
  updateDeadline,
} from "../services/tasksService.js";
import { extractTaskIntent } from "../voice/extractTaskIntent.js";
import { formatTaskDeadlineFull, isOverdue } from "../tasks/logic.js";
import { createLogger } from "../utils/logger.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { escapeMarkdown } from "../utils/markdown.js";
import * as chrono from "chrono-node";

const log = createLogger("tasks-mode");

const DB_UNAVAILABLE_MSG = "✅ Трекер задач недоступен (нет подключения к базе данных).";

// ─── State ──────────────────────────────────────────────────────────────

interface WorkCreationState {
  step: "name";
}

interface TaskCreationState {
  step: "text" | "deadline";
  workId: number;
  workName: string;
  text?: string;
}

/** In-memory creation wizard states (telegramId → state). */
const workCreationStates = new Map<number, WorkCreationState>();
const taskCreationStates = new Map<number, TaskCreationState>();

/** Voice task creation: waiting for work selection (telegramId → { text, deadline }). */
const voiceWorkSelection = new Map<number, { text: string; deadline: string | null }>();

interface TaskEditState {
  field: "text" | "deadline";
  taskItemId: number;
  workId: number;
}

/** In-memory edit wizard states (telegramId → state). */
const taskEditStates = new Map<number, TaskEditState>();

// ─── Keyboard ───────────────────────────────────────────────────────────

function getTasksKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📋 Мои проекты", "➕ Новый проект"],
    ["📜 История выполнения"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ───────────────────────────────────────────────────────

export async function handleTasksCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const dbUser = await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId),
  );

  if (!dbUser.tribeId) {
    await ctx.reply("✅ Трекер задач доступен только для участников трайба. Обратитесь к администратору.");
    return;
  }

  await setUserMode(telegramId, "tasks");
  await setModeMenuCommands(ctx, "tasks");

  // Clear any pending states
  clearStates(telegramId);

  await ctx.reply(
    "✅ *Режим Трекер задач активирован*\n\n" +
    "Создавайте проекты и добавляйте задачи с дедлайнами.\n" +
    "Напоминания придут за день, за 4 часа и за 1 час.\n\n" +
    "Задачи можно добавлять текстом или голосом 🎤",
    { parse_mode: "Markdown", ...getTasksKeyboard(isBootstrapAdmin(telegramId)) },
  );
}

function clearStates(telegramId: number): void {
  workCreationStates.delete(telegramId);
  taskCreationStates.delete(telegramId);
  voiceWorkSelection.delete(telegramId);
  taskEditStates.delete(telegramId);
}

// ─── My Projects ────────────────────────────────────────────────────────

export async function handleMyProjectsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const works = await getUserWorks(telegramId);
    if (works.length === 0) {
      await ctx.reply("У вас пока нет проектов. Нажмите «➕ Новый проект» чтобы создать.");
      return;
    }

    const buttons = works.map((w) => {
      const status = w.activeCount > 0 ? `${w.activeCount} активн.` : "нет задач";
      return [Markup.button.callback(
        `${w.emoji} ${w.name} — ${status}`,
        `tw_view:${w.id}`,
      )];
    });

    await ctx.reply("📋 *Ваши проекты:*", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (err: unknown) {
    log.error("handleMyProjectsButton error:", err);
    await ctx.reply(err instanceof Error ? err.message : "Ошибка при загрузке проектов.");
  }
}

// ─── New Project ────────────────────────────────────────────────────────

export async function handleNewProjectButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  clearStates(telegramId);
  workCreationStates.set(telegramId, { step: "name" });

  await ctx.reply("Введите название нового проекта:");
}

// ─── History ────────────────────────────────────────────────────────────

export async function handleTasksHistoryButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    const works = await getUserWorks(telegramId);
    if (works.length === 0) {
      await ctx.reply("У вас пока нет проектов.");
      return;
    }

    // Show works that have completed tasks
    const worksWithCompleted = works.filter((w) => w.completedCount > 0);
    if (worksWithCompleted.length === 0) {
      await ctx.reply("Нет выполненных задач.");
      return;
    }

    const buttons = worksWithCompleted.map((w) => [
      Markup.button.callback(
        `${w.emoji} ${w.name} (${w.completedCount} выполн.)`,
        `tw_hist:${w.id}`,
      ),
    ]);

    await ctx.reply("📜 *Выберите проект для просмотра истории:*", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (err: unknown) {
    log.error("handleTasksHistoryButton error:", err);
    await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
  }
}

// ─── Work Callbacks ─────────────────────────────────────────────────────

export async function handleTaskWorkCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  // tw_view:<workId> — show work with tasks
  if (data.startsWith("tw_view:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    await showWorkDetail(ctx, telegramId, workId);
    return;
  }

  // tw_add:<workId> — start adding task
  if (data.startsWith("tw_add:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    await startTaskCreation(ctx, telegramId, workId);
    return;
  }

  // tw_del:<workId> — delete work confirmation
  if (data.startsWith("tw_del:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    await ctx.reply(
      "Удалить проект со всеми задачами? Это действие необратимо.",
      Markup.inlineKeyboard([
        [Markup.button.callback("🗑 Да, удалить", `tw_del_yes:${workId}`)],
        [Markup.button.callback("Отмена", "noop")],
      ]),
    );
    return;
  }

  // tw_del_yes:<workId> — confirm deletion
  if (data.startsWith("tw_del_yes:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    try {
      const deleted = await removeWork(telegramId, workId);
      await ctx.reply(deleted ? "✅ Проект удалён." : "Проект не найден.");
    } catch (err: unknown) {
      await ctx.reply(err instanceof Error ? err.message : "Ошибка при удалении.");
    }
    return;
  }

  // tw_archive:<workId> — archive work
  if (data.startsWith("tw_archive:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    try {
      const { archiveWork } = await import("../services/tasksService.js");
      const archived = await archiveWork(telegramId, workId);
      await ctx.reply(archived ? "📦 Проект архивирован." : "Проект не найден.");
    } catch (err: unknown) {
      await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
    }
    return;
  }

  // tw_hist:<workId> — show completed history
  if (data.startsWith("tw_hist:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    await showCompletedHistory(ctx, telegramId, workId);
    return;
  }

  // tw_voice_work:<workId> — pick work for voice task
  if (data.startsWith("tw_voice_work:")) {
    const workId = parseInt(data.split(":")[1], 10);
    if (isNaN(workId)) return;
    await handleVoiceWorkPick(ctx, telegramId, workId);
    return;
  }
}

// ─── Task Item Callbacks ────────────────────────────────────────────────

export async function handleTaskItemCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  // ti_done:<itemId>:<workId> — toggle completion
  if (data.startsWith("ti_done:")) {
    const parts = data.split(":");
    const itemId = parseInt(parts[1], 10);
    const workId = parseInt(parts[2], 10);
    if (isNaN(itemId)) return;
    try {
      const toggled = await toggleTask(telegramId, itemId);
      if (toggled) {
        const status = toggled.isCompleted ? "✅ Задача выполнена!" : "🔄 Задача возвращена в работу.";
        await ctx.reply(status);
        // Refresh work detail
        if (!isNaN(workId)) await showWorkDetail(ctx, telegramId, workId);
      } else {
        await ctx.reply("Задача не найдена.");
      }
    } catch (err: unknown) {
      await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
    }
    return;
  }

  // ti_del:<itemId>:<workId> — delete task
  if (data.startsWith("ti_del:")) {
    const parts = data.split(":");
    const itemId = parseInt(parts[1], 10);
    const workId = parseInt(parts[2], 10);
    if (isNaN(itemId)) return;
    try {
      const deleted = await removeTask(telegramId, itemId);
      await ctx.reply(deleted ? "🗑 Задача удалена." : "Задача не найдена.");
      if (deleted && !isNaN(workId)) await showWorkDetail(ctx, telegramId, workId);
    } catch (err: unknown) {
      await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
    }
    return;
  }

  // ti_edit:<itemId>:<workId> — show edit options
  if (data.startsWith("ti_edit:")) {
    const parts = data.split(":");
    const itemId = parseInt(parts[1], 10);
    const workId = parseInt(parts[2], 10);
    if (isNaN(itemId) || isNaN(workId)) return;
    await ctx.reply(
      "Что изменить?",
      Markup.inlineKeyboard([
        [Markup.button.callback("📝 Изменить текст", `ti_edt:${itemId}:${workId}`)],
        [Markup.button.callback("⏰ Изменить дедлайн", `ti_edl:${itemId}:${workId}`)],
        [Markup.button.callback("Отмена", "noop")],
      ]),
    );
    return;
  }

  // ti_edt:<itemId>:<workId> — start editing text
  if (data.startsWith("ti_edt:")) {
    const parts = data.split(":");
    const itemId = parseInt(parts[1], 10);
    const workId = parseInt(parts[2], 10);
    if (isNaN(itemId) || isNaN(workId)) return;
    clearStates(telegramId);
    taskEditStates.set(telegramId, { field: "text", taskItemId: itemId, workId });
    await ctx.reply("Введите новый текст задачи:");
    return;
  }

  // ti_edl:<itemId>:<workId> — start editing deadline
  if (data.startsWith("ti_edl:")) {
    const parts = data.split(":");
    const itemId = parseInt(parts[1], 10);
    const workId = parseInt(parts[2], 10);
    if (isNaN(itemId) || isNaN(workId)) return;
    clearStates(telegramId);
    taskEditStates.set(telegramId, { field: "deadline", taskItemId: itemId, workId });
    await ctx.reply(
      "Введите новый дедлайн:\n\nПримеры: `завтра 18:00`, `понедельник 15:00`, `30.03 12:00`",
      { parse_mode: "Markdown" },
    );
    return;
  }
}

// ─── Pagination ─────────────────────────────────────────────────────────

export async function handleTasksPageCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  await ctx.answerCbQuery();

  // t_page:<workId>:<offset> — paginate tasks
  if (data.startsWith("t_page:")) {
    const parts = data.split(":");
    const workId = parseInt(parts[1], 10);
    if (isNaN(workId)) return;
    await showWorkDetail(ctx, telegramId, workId);
  }
}

// ─── Text Handler ───────────────────────────────────────────────────────

export async function handleTasksText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text.trim();
  if (!text) return false;

  // Edit state handler (must come before creation wizards)
  const editState = taskEditStates.get(telegramId);
  if (editState) {
    return await handleEditInput(ctx, telegramId, editState, text);
  }

  // Work creation wizard
  const workState = workCreationStates.get(telegramId);
  if (workState?.step === "name") {
    workCreationStates.delete(telegramId);
    try {
      const work = await createNewWork(telegramId, text);
      await ctx.reply(
        `${work.emoji} Проект *${escapeMarkdown(work.name)}* создан!\n\nТеперь добавьте задачи с дедлайнами.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("➕ Добавить задачу", `tw_add:${work.id}`)],
          ]),
        },
      );
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes("уже существует") || err.message.includes("unique"))) {
        await ctx.reply("Проект с таким названием уже существует. Введите другое название:");
        workCreationStates.set(telegramId, { step: "name" });
      } else {
        await ctx.reply(err instanceof Error ? err.message : "Ошибка при создании проекта.");
      }
    }
    return true;
  }

  // Task creation wizard
  const taskState = taskCreationStates.get(telegramId);
  if (taskState) {
    if (taskState.step === "text") {
      taskCreationStates.set(telegramId, {
        ...taskState,
        step: "deadline",
        text,
      });
      await ctx.reply(
        "Укажите дедлайн задачи.\n\n" +
        "Примеры:\n" +
        "• `завтра 18:00`\n" +
        "• `понедельник 15:00`\n" +
        "• `30.03 12:00`\n" +
        "• `2026-04-01 09:00`",
        { parse_mode: "Markdown" },
      );
      return true;
    }

    if (taskState.step === "deadline") {
      const deadline = parseDeadline(text);
      if (!deadline) {
        await ctx.reply("Не удалось распознать дату. Попробуйте ещё раз (например: `завтра 18:00`):", {
          parse_mode: "Markdown",
        });
        return true;
      }

      taskCreationStates.delete(telegramId);
      try {
        const item = await addTask(telegramId, taskState.workId, taskState.text!, deadline);
        const deadlineStr = formatTaskDeadlineFull(new Date(item.deadline));
        await ctx.reply(
          `✅ Задача добавлена в *${escapeMarkdown(taskState.workName)}*\n\n` +
          `📝 ${escapeMarkdown(item.text)}\n` +
          `⏰ Дедлайн: ${deadlineStr}`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("➕ Ещё задачу", `tw_add:${taskState.workId}`)],
              [Markup.button.callback("📋 К проекту", `tw_view:${taskState.workId}`)],
            ]),
          },
        );
      } catch (err: unknown) {
        await ctx.reply(err instanceof Error ? err.message : "Ошибка при создании задачи.");
      }
      return true;
    }
  }

  return false;
}

// ─── Voice Handler ──────────────────────────────────────────────────────

export async function handleTasksVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  try {
    // Get user's work list for matching
    const works = await getUserWorks(telegramId);
    const workNames = works.map((w) => w.name);

    const result = await extractTaskIntent(transcript, workNames);

    if (result.type === "not_task") {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        `Распознано: _${escapeMarkdown(transcript)}_\n\nНе удалось определить задачу. Попробуйте сказать, например: «добавь задачу в Росатом, сдать отчёт к пятнице 18:00».`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // result.type === "task"
    const { work, text, deadline } = result;

    // If no works at all, ask to create one first
    if (works.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        `Распознано: _${escapeMarkdown(transcript)}_\n\nСначала создайте проект с помощью кнопки «➕ Новый проект».`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // If work is not determined, ask user to pick
    if (!work) {
      voiceWorkSelection.set(telegramId, { text, deadline });

      const buttons = works.map((w) => [
        Markup.button.callback(`${w.emoji} ${w.name}`, `tw_voice_work:${w.id}`),
      ]);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        `Распознано: _${escapeMarkdown(transcript)}_\n\nВ какой проект добавить задачу?`,
        { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
      );
      return;
    }

    // Find the matched work
    const matchedWork = works.find((w) => w.name.toLowerCase() === work.toLowerCase());
    if (!matchedWork) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        `Проект «${escapeMarkdown(work)}» не найден.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // If deadline is determined, create task directly
    if (deadline) {
      const deadlineDate = new Date(deadline);
      if (isNaN(deadlineDate.getTime())) {
        // Invalid date from AI, ask user to specify
        taskCreationStates.set(telegramId, {
          step: "deadline",
          workId: matchedWork.id,
          workName: matchedWork.name,
          text,
        });
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsgId,
          undefined,
          `Распознано: _${escapeMarkdown(transcript)}_\n\nЗадача: ${escapeMarkdown(text)}\nПроект: ${matchedWork.emoji} ${escapeMarkdown(matchedWork.name)}\n\nУкажите дедлайн (например: \`завтра 18:00\`):`,
          { parse_mode: "Markdown" },
        );
        return;
      }

      try {
        const item = await addTask(telegramId, matchedWork.id, text, deadlineDate, "voice");
        const deadlineStr = formatTaskDeadlineFull(new Date(item.deadline));
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsgId,
          undefined,
          `✅ Задача добавлена в *${escapeMarkdown(matchedWork.name)}*\n\n` +
          `📝 ${escapeMarkdown(item.text)}\n` +
          `⏰ Дедлайн: ${deadlineStr}`,
          { parse_mode: "Markdown" },
        );
      } catch (err: unknown) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsgId,
          undefined,
          err instanceof Error ? err.message : "Ошибка при создании задачи.",
        );
      }
      return;
    }

    // No deadline — ask user to specify
    taskCreationStates.set(telegramId, {
      step: "deadline",
      workId: matchedWork.id,
      workName: matchedWork.name,
      text,
    });
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsgId,
      undefined,
      `Распознано: _${escapeMarkdown(transcript)}_\n\nЗадача: ${escapeMarkdown(text)}\nПроект: ${matchedWork.emoji} ${escapeMarkdown(matchedWork.name)}\n\nУкажите дедлайн (например: \`завтра 18:00\`):`,
      { parse_mode: "Markdown" },
    );
  } catch (err: unknown) {
    log.error("handleTasksVoice error:", err);
    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsgId,
        undefined,
        "Ошибка при обработке голосового сообщения.",
      );
    } catch {
      // edit failed
    }
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────

async function showWorkDetail(
  ctx: Context,
  telegramId: number,
  workId: number,
): Promise<void> {
  try {
    const data = await getWorkWithTasks(telegramId, workId);
    if (!data) {
      await ctx.reply("Проект не найден.");
      return;
    }

    const { work, tasks } = data;
    const activeTasks = tasks.filter((t) => !t.isCompleted);
    const completedTasks = tasks.filter((t) => t.isCompleted);

    let msg = `${work.emoji} *${escapeMarkdown(work.name)}*\n`;
    msg += `Активных: ${activeTasks.length} | Выполненных: ${completedTasks.length}\n\n`;

    if (activeTasks.length === 0 && completedTasks.length === 0) {
      msg += "_Нет задач. Добавьте первую задачу._";
    }

    // Show active tasks
    for (const task of activeTasks) {
      const dl = formatTaskDeadlineFull(new Date(task.deadline));
      const overdue = isOverdue(new Date(task.deadline)) ? " ⚠️" : "";
      msg += `⬜ ${escapeMarkdown(task.text)}\n  ⏰ ${dl}${overdue}\n\n`;
    }

    // Show recent completed (up to 3)
    if (completedTasks.length > 0) {
      msg += `_Выполнено (последние):_\n`;
      for (const task of completedTasks.slice(0, 3)) {
        msg += `✅ ~${escapeMarkdown(task.text)}~\n`;
      }
      if (completedTasks.length > 3) {
        msg += `_...и ещё ${completedTasks.length - 3}_\n`;
      }
    }

    // Build action buttons for active tasks
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

    for (const task of activeTasks) {
      buttons.push([
        Markup.button.callback(`✅ ${task.text.substring(0, 30)}`, `ti_done:${task.id}:${workId}`),
        Markup.button.callback("✏️", `ti_edit:${task.id}:${workId}`),
        Markup.button.callback("🗑", `ti_del:${task.id}:${workId}`),
      ]);
    }

    buttons.push([Markup.button.callback("➕ Добавить задачу", `tw_add:${workId}`)]);
    buttons.push([
      Markup.button.callback("🗑 Удалить проект", `tw_del:${workId}`),
      Markup.button.callback("📦 В архив", `tw_archive:${workId}`),
    ]);

    await ctx.reply(msg, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (err: unknown) {
    log.error("showWorkDetail error:", err);
    await ctx.reply(err instanceof Error ? err.message : "Ошибка при загрузке проекта.");
  }
}

async function startTaskCreation(
  ctx: Context,
  telegramId: number,
  workId: number,
): Promise<void> {
  try {
    const data = await getWorkWithTasks(telegramId, workId);
    if (!data) {
      await ctx.reply("Проект не найден.");
      return;
    }

    clearStates(telegramId);
    taskCreationStates.set(telegramId, {
      step: "text",
      workId,
      workName: data.work.name,
    });

    await ctx.reply(
      `Добавление задачи в *${escapeMarkdown(data.work.name)}*\n\nВведите описание задачи:`,
      { parse_mode: "Markdown" },
    );
  } catch (err: unknown) {
    await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
  }
}

async function showCompletedHistory(
  ctx: Context,
  telegramId: number,
  workId: number,
): Promise<void> {
  try {
    const history = await getCompletedHistory(telegramId, workId);
    if (history.length === 0) {
      await ctx.reply("Нет выполненных задач в этом проекте.");
      return;
    }

    let msg = "📜 *История выполнения:*\n\n";
    for (const item of history) {
      const completedDate = item.completedAt
        ? formatTaskDeadlineFull(new Date(item.completedAt))
        : "—";
      msg += `✅ ${escapeMarkdown(item.text)}\n  Выполнено: ${completedDate}\n\n`;
    }

    await ctx.reply(msg, { parse_mode: "Markdown" });
  } catch (err: unknown) {
    await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
  }
}

async function handleVoiceWorkPick(
  ctx: Context,
  telegramId: number,
  workId: number,
): Promise<void> {
  const pending = voiceWorkSelection.get(telegramId);
  if (!pending) {
    await ctx.reply("Сессия истекла. Отправьте голосовое ещё раз.");
    return;
  }
  voiceWorkSelection.delete(telegramId);

  const { text, deadline } = pending;

  if (deadline) {
    const deadlineDate = new Date(deadline);
    if (!isNaN(deadlineDate.getTime())) {
      try {
        const item = await addTask(telegramId, workId, text, deadlineDate, "voice");
        const deadlineStr = formatTaskDeadlineFull(new Date(item.deadline));
        await ctx.reply(
          `✅ Задача добавлена\n\n📝 ${escapeMarkdown(item.text)}\n⏰ Дедлайн: ${deadlineStr}`,
          { parse_mode: "Markdown" },
        );
      } catch (err: unknown) {
        await ctx.reply(err instanceof Error ? err.message : "Ошибка.");
      }
      return;
    }
  }

  // Need deadline — ask via text
  const data = await getWorkWithTasks(telegramId, workId);
  if (!data) {
    await ctx.reply("Проект был удалён. Создайте новый.");
    return;
  }
  const workName = data.work.name;
  taskCreationStates.set(telegramId, {
    step: "deadline",
    workId,
    workName,
    text,
  });
  await ctx.reply(
    `Задача: ${escapeMarkdown(text)}\nПроект: ${escapeMarkdown(workName)}\n\nУкажите дедлайн (например: \`завтра 18:00\`):`,
    { parse_mode: "Markdown" },
  );
}

/**
 * Parse a deadline string using chrono-node (Russian locale).
 * Returns a Date or null if parsing fails.
 */
function parseDeadline(text: string): Date | null {
  // Try chrono-node first (handles Russian dates like "завтра 18:00")
  // Use MSK reference so "11:00" means 11:00 Moscow time, not server-local
  const results = chrono.ru.parse(text, { instant: new Date(), timezone: "MSK" as const }, { forwardDate: true });
  if (results.length > 0) {
    return results[0].start.date();
  }

  // Try parsing ISO or common formats as fallback
  // If no timezone info present, interpret as MSK (UTC+3)
  const hasTimezone = /[Zz]$/.test(text) || /[+-]\d{2}(:\d{2})?$/.test(text);
  const date = new Date(hasTimezone ? text : text + "+03:00");
  if (!isNaN(date.getTime()) && date.getTime() > Date.now()) {
    return date;
  }

  // Try DD.MM format (common Russian format)
  const ddmmMatch = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (ddmmMatch) {
    const day = parseInt(ddmmMatch[1], 10);
    const month = parseInt(ddmmMatch[2], 10) - 1;
    const year = ddmmMatch[3] ? parseInt(ddmmMatch[3], 10) : new Date().getFullYear();
    const hours = parseInt(ddmmMatch[4], 10);
    const minutes = parseInt(ddmmMatch[5], 10);
    // MSK is always UTC+3 (no DST since 2014)
    const parsed = new Date(Date.UTC(year, month, day, hours - 3, minutes));
    if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      return parsed;
    }
  }

  return null;
}

/**
 * Handle text input for task edit wizards (text or deadline).
 */
async function handleEditInput(
  ctx: Context,
  telegramId: number,
  edit: TaskEditState,
  text: string,
): Promise<boolean> {
  try {
    if (edit.field === "text") {
      taskEditStates.delete(telegramId);
      const updated = await updateText(telegramId, edit.taskItemId, text);
      if (!updated) {
        await ctx.reply("Задача не найдена.");
        return true;
      }
      await ctx.reply(`✅ Текст обновлён: ${escapeMarkdown(updated.text)}`, {
        parse_mode: "Markdown",
      });
      await showWorkDetail(ctx, telegramId, edit.workId);
      return true;
    }

    if (edit.field === "deadline") {
      const deadline = parseDeadline(text);
      if (!deadline) {
        await ctx.reply(
          "Не удалось распознать дату. Попробуйте ещё раз (например: `завтра 18:00`):",
          { parse_mode: "Markdown" },
        );
        return true;
      }

      taskEditStates.delete(telegramId);
      const updated = await updateDeadline(telegramId, edit.taskItemId, deadline);
      if (!updated) {
        await ctx.reply("Задача не найдена.");
        return true;
      }
      const deadlineStr = formatTaskDeadlineFull(new Date(updated.deadline));
      await ctx.reply(`✅ Дедлайн обновлён: ${deadlineStr}`);
      await showWorkDetail(ctx, telegramId, edit.workId);
      return true;
    }
  } catch (err: unknown) {
    log.error("handleEditInput error:", err);
    await ctx.reply(err instanceof Error ? err.message : "Ошибка при обновлении.");
  }

  taskEditStates.delete(telegramId);
  return true;
}
