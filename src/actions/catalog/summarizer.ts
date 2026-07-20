import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserWorkplaces,
  createNewWorkplace,
  editWorkplace,
  removeWorkplace,
  getWorkplaceAchievements,
  addAchievement,
  editAchievement,
  removeAchievement,
  generateSummary,
} from "../../services/summarizerService.js";

const workplaceIdArg = z.object({ id: z.number().int().positive() });
const achievementIdArg = z.object({ id: z.number().int().positive() });

export const summarizerActions: Action[] = [
  defineAction({
    name: "summarizer.workplaces.list", mode: "summarizer", humanTitle: "Список мест работы",
    description: "Показать места работы (с количеством достижений и id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getUserWorkplaces(ctx.telegramId) }),
  }),
  defineAction({
    name: "summarizer.workplace.create", mode: "summarizer", humanTitle: "Добавить место работы",
    description: "Создать место работы (должность, опц. компания).",
    argsSchema: z.object({ title: z.string().min(1), company: z.string().optional() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createNewWorkplace(ctx.telegramId, a.title.trim(), a.company) }),
  }),
  defineAction({
    name: "summarizer.workplace.update", mode: "summarizer", humanTitle: "Изменить место работы",
    description: "Изменить должность/компанию места работы по id (переданные поля).",
    argsSchema: z.object({
      id: z.number().int().positive(),
      title: z.string().optional(),
      company: z.string().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const { id, ...updates } = a;
      const w = await editWorkplace(ctx.telegramId, id, updates);
      if (!w) throw new Error("Место работы не найдено.");
      return { data: w };
    },
  }),
  defineAction({
    name: "summarizer.workplace.delete", mode: "summarizer", humanTitle: "Удалить место работы",
    description: "Удалить место работы и все его достижения по id.",
    argsSchema: workplaceIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeWorkplace(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "summarizer.achievements.list", mode: "summarizer", humanTitle: "Достижения места работы",
    description: "Показать достижения места работы по workplaceId (пагинация limit/offset).",
    argsSchema: z.object({
      workplaceId: z.number().int().positive(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getWorkplaceAchievements(ctx.telegramId, a.workplaceId, a.limit ?? 5, a.offset ?? 0) }),
  }),
  defineAction({
    name: "summarizer.achievement.add", mode: "summarizer", humanTitle: "Добавить достижение",
    description: "Добавить достижение к месту работы (workplaceId, текст).",
    argsSchema: z.object({ workplaceId: z.number().int().positive(), text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await addAchievement(ctx.telegramId, a.workplaceId, a.text.trim()) }),
  }),
  defineAction({
    name: "summarizer.achievement.edit", mode: "summarizer", humanTitle: "Изменить достижение",
    description: "Изменить текст достижения по id.",
    argsSchema: z.object({ id: z.number().int().positive(), text: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => {
      const ach = await editAchievement(ctx.telegramId, a.id, a.text.trim());
      if (!ach) throw new Error("Достижение не найдено.");
      return { data: ach };
    },
  }),
  defineAction({
    name: "summarizer.achievement.delete", mode: "summarizer", humanTitle: "Удалить достижение",
    description: "Удалить достижение по id.",
    argsSchema: achievementIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeAchievement(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "summarizer.generate", mode: "summarizer", humanTitle: "Сгенерировать резюме",
    description: "Сгенерировать профессиональное саммари достижений места работы через LLM (по workplaceId).",
    argsSchema: z.object({ workplaceId: z.number().int().positive() }), mutates: true, heavy: true,
    handler: async (ctx, a) => ({ data: await generateSummary(ctx.telegramId, a.workplaceId) }),
  }),
];
