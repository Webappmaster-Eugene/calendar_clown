// MTProto auth and the digest run need binary/bot context a plain text surface
// can't provide, so those actions stay guarded.
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserRubrics,
  createNewRubric,
  editRubric,
  removeRubric,
  toggleRubricActive,
  getRubricChannels,
  addChannelToRubric,
  removeChannelFromRubric,
} from "../../services/digestService.js";

const rubricIdArg = z.object({ id: z.number().int().positive() });

export const digestActions: Action[] = [
  defineAction({
    name: "digest.rubrics.list", mode: "digest", humanTitle: "Список рубрик",
    description: "Показать рубрики дайджеста пользователя (с числом каналов и id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getUserRubrics(ctx.telegramId) }),
  }),
  defineAction({
    name: "digest.rubric.create", mode: "digest", humanTitle: "Создать рубрику",
    description: "Создать рубрику дайджеста (name, опц. описание, эмодзи, ключевые слова).",
    argsSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      emoji: z.string().optional(),
      keywords: z.array(z.string()).optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({
      data: await createNewRubric(ctx.telegramId, {
        name: a.name.trim(),
        description: a.description,
        emoji: a.emoji,
        keywords: a.keywords,
      }),
    }),
  }),
  defineAction({
    name: "digest.rubric.edit", mode: "digest", humanTitle: "Изменить рубрику",
    description: "Изменить рубрику по id (переданные поля: name/описание/эмодзи/ключевые слова).",
    argsSchema: z.object({
      id: z.number().int().positive(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      emoji: z.string().nullable().optional(),
      keywords: z.array(z.string()).optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const { id, ...updates } = a;
      const rubric = await editRubric(ctx.telegramId, id, {
        name: updates.name?.trim(),
        description: updates.description,
        emoji: updates.emoji,
        keywords: updates.keywords,
      });
      if (!rubric) throw new Error("Рубрика не найдена.");
      return { data: rubric };
    },
  }),
  defineAction({
    name: "digest.rubric.delete", mode: "digest", humanTitle: "Удалить рубрику",
    description: "Удалить рубрику дайджеста и её каналы по id.",
    argsSchema: rubricIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeRubric(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "digest.rubric.toggle", mode: "digest", humanTitle: "Переключить рубрику",
    description: "Включить/выключить рубрику дайджеста по id.",
    argsSchema: rubricIdArg, mutates: true,
    handler: async (ctx, a) => {
      const rubric = await toggleRubricActive(ctx.telegramId, a.id);
      if (!rubric) throw new Error("Рубрика не найдена.");
      return { data: rubric };
    },
  }),
  defineAction({
    name: "digest.channels.list", mode: "digest", humanTitle: "Каналы рубрики",
    description: "Показать каналы рубрики по rubricId.",
    argsSchema: z.object({ rubricId: z.number().int().positive() }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getRubricChannels(ctx.telegramId, a.rubricId) }),
  }),
  defineAction({
    name: "digest.channel.add", mode: "digest", humanTitle: "Добавить канал",
    description: "Добавить канал в рубрику (rubricId, channelUsername).",
    argsSchema: z.object({
      rubricId: z.number().int().positive(),
      channelUsername: z.string().min(1),
    }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await addChannelToRubric(ctx.telegramId, a.rubricId, a.channelUsername.trim()) }),
  }),
  defineAction({
    name: "digest.channel.remove", mode: "digest", humanTitle: "Удалить канал",
    description: "Удалить канал из рубрики (нужны rubricId и channelId для проверки владения).",
    argsSchema: z.object({
      rubricId: z.number().int().positive(),
      channelId: z.number().int().positive(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({
      data: {
        deleted: await removeChannelFromRubric(ctx.telegramId, a.rubricId, a.channelId),
        rubricId: a.rubricId,
        channelId: a.channelId,
      },
    }),
  }),
  defineAction({
    name: "digest.run", mode: "digest", humanTitle: "Запустить дайджест",
    description: "Запустить дайджест по всем активным рубрикам (читает каналы через MTProto, шлёт результат в бот).",
    argsSchema: z.object({}), mutates: true, heavy: true,
    handler: async (ctx) => {
      const { getBotInstance } = await import("../../botInstance.js");
      const bot = getBotInstance();
      if (!bot) throw new Error("Бот не инициализирован — запуск дайджеста недоступен.");
      const { runDigestForUser } = await import("../../digest/worker.js");
      const processed = await runDigestForUser(ctx.telegramId, bot);
      return { data: { rubricsProcessed: processed } };
    },
  }),
  defineAction({
    name: "digest.auth", mode: "digest", humanTitle: "Авторизация MTProto",
    description: "Авторизоваться в MTProto для чтения Telegram-каналов (нужен Mini App / web-token).",
    argsSchema: z.object({}), mutates: true, requiresUI: "auth",
    handler: async () => { throw new Error("Авторизация MTProto — через Mini App / web-token."); },
  }),
];
