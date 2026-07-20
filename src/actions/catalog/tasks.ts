import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserWorks,
  getWorkWithTasks,
  createNewWork,
  removeWork,
  archiveWork,
  addTask,
  toggleTask,
  updateDeadline,
  updateText,
  removeTask,
  getCompletedHistory,
} from "../../services/tasksService.js";

// Naive datetime strings are interpreted as MSK (UTC+3); explicit offsets pass through.
function parseMskDeadline(deadline: string): Date {
  if (/[Zz]$/.test(deadline) || /[+-]\d{2}(:\d{2})?$/.test(deadline)) {
    return new Date(deadline);
  }
  return new Date(deadline + "+03:00");
}

const workIdArg = z.object({ id: z.number().int().positive() });
const itemIdArg = z.object({ itemId: z.number().int().positive() });
const deadlineField = z.string().describe('Дедлайн ISO 8601, напр. "2026-07-25T18:00:00+03:00" (без TZ → МСК)');

export const tasksActions: Action[] = [
  defineAction({
    name: "tasks.projects.list",
    mode: "tasks",
    humanTitle: "Список проектов",
    description: "Показать проекты задач пользователя (с id и активными задачами).",
    argsSchema: z.object({}),
    mutates: false,
    handler: async (ctx) => ({ data: await getUserWorks(ctx.telegramId) }),
  }),
  defineAction({
    name: "tasks.project.get",
    mode: "tasks",
    humanTitle: "Проект с задачами",
    description: "Показать проект и его задачи по id проекта.",
    argsSchema: workIdArg,
    mutates: false,
    handler: async (ctx, a) => {
      const res = await getWorkWithTasks(ctx.telegramId, a.id);
      if (!res) throw new Error("Проект не найден.");
      return { data: res };
    },
  }),
  defineAction({
    name: "tasks.project.create",
    mode: "tasks",
    humanTitle: "Создать проект",
    description: "Создать новый проект задач.",
    argsSchema: z.object({ name: z.string().min(1), emoji: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createNewWork(ctx.telegramId, a.name.trim(), a.emoji) }),
  }),
  defineAction({
    name: "tasks.project.delete",
    mode: "tasks",
    humanTitle: "Удалить проект",
    description: "Удалить проект и все его задачи по id.",
    argsSchema: workIdArg,
    mutates: true,
    handler: async (ctx, a) => {
      const deleted = await removeWork(ctx.telegramId, a.id);
      if (!deleted) throw new Error("Проект не найден.");
      return { data: { deleted: true, id: a.id } };
    },
  }),
  defineAction({
    name: "tasks.project.archive",
    mode: "tasks",
    humanTitle: "Архивировать проект",
    description: "Архивировать проект по id.",
    argsSchema: workIdArg,
    mutates: true,
    handler: async (ctx, a) => {
      const archived = await archiveWork(ctx.telegramId, a.id);
      if (!archived) throw new Error("Проект не найден.");
      return { data: archived };
    },
  }),
  defineAction({
    name: "tasks.history",
    mode: "tasks",
    humanTitle: "История выполнения",
    description: "Показать выполненные задачи проекта по id.",
    argsSchema: workIdArg,
    mutates: false,
    handler: async (ctx, a) => ({ data: await getCompletedHistory(ctx.telegramId, a.id) }),
  }),
  defineAction({
    name: "tasks.item.add",
    mode: "tasks",
    humanTitle: "Добавить задачу",
    description: "Добавить задачу в проект с дедлайном.",
    argsSchema: z.object({
      workId: z.number().int().positive(),
      text: z.string().min(1),
      deadline: deadlineField,
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const deadline = parseMskDeadline(a.deadline);
      if (isNaN(deadline.getTime())) throw new Error("Неверный формат дедлайна.");
      return { data: await addTask(ctx.telegramId, a.workId, a.text.trim(), deadline) };
    },
  }),
  defineAction({
    name: "tasks.item.toggle",
    mode: "tasks",
    humanTitle: "Отметить задачу",
    description: "Переключить выполнение задачи по itemId.",
    argsSchema: itemIdArg,
    mutates: true,
    handler: async (ctx, a) => {
      const t = await toggleTask(ctx.telegramId, a.itemId);
      if (!t) throw new Error("Задача не найдена.");
      return { data: t };
    },
  }),
  defineAction({
    name: "tasks.item.setDeadline",
    mode: "tasks",
    humanTitle: "Изменить дедлайн",
    description: "Изменить дедлайн задачи по itemId.",
    argsSchema: z.object({ itemId: z.number().int().positive(), deadline: deadlineField }),
    mutates: true,
    handler: async (ctx, a) => {
      const deadline = parseMskDeadline(a.deadline);
      if (isNaN(deadline.getTime())) throw new Error("Неверный формат дедлайна.");
      const t = await updateDeadline(ctx.telegramId, a.itemId, deadline);
      if (!t) throw new Error("Задача не найдена.");
      return { data: t };
    },
  }),
  defineAction({
    name: "tasks.item.setText",
    mode: "tasks",
    humanTitle: "Изменить текст задачи",
    description: "Изменить текст задачи по itemId.",
    argsSchema: z.object({ itemId: z.number().int().positive(), text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => {
      const t = await updateText(ctx.telegramId, a.itemId, a.text.trim());
      if (!t) throw new Error("Задача не найдена.");
      return { data: t };
    },
  }),
  defineAction({
    name: "tasks.item.delete",
    mode: "tasks",
    humanTitle: "Удалить задачу",
    description: "Удалить задачу по itemId.",
    argsSchema: itemIdArg,
    mutates: true,
    handler: async (ctx, a) => {
      const deleted = await removeTask(ctx.telegramId, a.itemId);
      if (!deleted) throw new Error("Задача не найдена.");
      return { data: { deleted: true, itemId: a.itemId } };
    },
  }),
];
