import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserGoalSets,
  getFriendsGoalSets,
  getGoalSetWithGoals,
  createNewGoalSet,
  updateGoalSetProps,
  removeGoalSet,
  addGoal,
  editGoalText,
  toggleGoal,
  removeGoal,
  getGoalSetViewers,
  addGoalSetViewer,
  removeGoalSetViewer,
} from "../../services/goalsService.js";

const setIdArg = z.object({ id: z.number().int().positive() });
const goalIdArg = z.object({ goalId: z.number().int().positive() });
const period = z.enum(["current", "month", "year", "5years"]);

export const goalsActions: Action[] = [
  defineAction({
    name: "goals.sets.list", mode: "goals", humanTitle: "Список наборов целей",
    description: "Показать наборы целей пользователя (с прогрессом и id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getUserGoalSets(ctx.telegramId) }),
  }),
  defineAction({
    name: "goals.shared.list", mode: "goals", humanTitle: "Цели друзей",
    description: "Показать публичные наборы целей других участников трайба.",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getFriendsGoalSets(ctx.telegramId) }),
  }),
  defineAction({
    name: "goals.set.get", mode: "goals", humanTitle: "Набор с целями",
    description: "Показать набор и его цели по id.",
    argsSchema: setIdArg, mutates: false,
    handler: async (ctx, a) => {
      const res = await getGoalSetWithGoals(ctx.telegramId, a.id);
      if (!res) throw new Error("Набор целей не найден.");
      return { data: res };
    },
  }),
  defineAction({
    name: "goals.set.create", mode: "goals", humanTitle: "Создать набор целей",
    description: "Создать набор целей с периодом (current/month/year/5years).",
    argsSchema: z.object({ name: z.string().min(1), period, emoji: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createNewGoalSet(ctx.telegramId, a.name.trim(), a.period, a.emoji) }),
  }),
  defineAction({
    name: "goals.set.update", mode: "goals", humanTitle: "Изменить набор целей",
    description: "Изменить название/эмодзи/видимость набора по id.",
    argsSchema: z.object({
      id: z.number().int().positive(),
      name: z.string().optional(), emoji: z.string().optional(),
      visibility: z.enum(["public", "private"]).optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const res = await updateGoalSetProps(ctx.telegramId, a.id, { name: a.name, emoji: a.emoji, visibility: a.visibility });
      if (!res) throw new Error("Набор целей не найден.");
      return { data: res };
    },
  }),
  defineAction({
    name: "goals.set.delete", mode: "goals", humanTitle: "Удалить набор целей",
    description: "Удалить набор целей и все его цели по id.",
    argsSchema: setIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeGoalSet(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "goals.goal.add", mode: "goals", humanTitle: "Добавить цель",
    description: "Добавить цель в набор.",
    argsSchema: z.object({ goalSetId: z.number().int().positive(), text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await addGoal(ctx.telegramId, a.goalSetId, a.text.trim()) }),
  }),
  defineAction({
    name: "goals.goal.setText", mode: "goals", humanTitle: "Изменить текст цели",
    description: "Изменить текст цели по goalId.",
    argsSchema: z.object({ goalId: z.number().int().positive(), text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => {
      const g = await editGoalText(ctx.telegramId, a.goalId, a.text.trim());
      if (!g) throw new Error("Цель не найдена.");
      return { data: g };
    },
  }),
  defineAction({
    name: "goals.goal.toggle", mode: "goals", humanTitle: "Отметить цель",
    description: "Переключить выполнение цели по goalId.",
    argsSchema: goalIdArg, mutates: true,
    handler: async (ctx, a) => {
      const g = await toggleGoal(ctx.telegramId, a.goalId);
      if (!g) throw new Error("Цель не найдена.");
      return { data: g };
    },
  }),
  defineAction({
    name: "goals.goal.delete", mode: "goals", humanTitle: "Удалить цель",
    description: "Удалить цель по goalId.",
    argsSchema: goalIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeGoal(ctx.telegramId, a.goalId), goalId: a.goalId } }),
  }),
  defineAction({
    name: "goals.viewers.list", mode: "goals", humanTitle: "Кто видит набор",
    description: "Список зрителей набора целей по id.",
    argsSchema: setIdArg, mutates: false,
    handler: async (ctx, a) => ({ data: await getGoalSetViewers(ctx.telegramId, a.id) }),
  }),
  defineAction({
    name: "goals.viewers.add", mode: "goals", humanTitle: "Добавить зрителя",
    description: "Дать участнику (viewerUserId) доступ к набору целей.",
    argsSchema: z.object({ id: z.number().int().positive(), viewerUserId: z.number().int().positive() }),
    mutates: true,
    handler: async (ctx, a) => {
      await addGoalSetViewer(ctx.telegramId, a.id, a.viewerUserId);
      return { data: { added: true, id: a.id, viewerUserId: a.viewerUserId } };
    },
  }),
  defineAction({
    name: "goals.viewers.remove", mode: "goals", humanTitle: "Убрать зрителя",
    description: "Убрать доступ участника (viewerUserId) к набору целей.",
    argsSchema: z.object({ id: z.number().int().positive(), viewerUserId: z.number().int().positive() }),
    mutates: true,
    handler: async (ctx, a) => {
      await removeGoalSetViewer(ctx.telegramId, a.id, a.viewerUserId);
      return { data: { removed: true, id: a.id, viewerUserId: a.viewerUserId } };
    },
  }),
];
