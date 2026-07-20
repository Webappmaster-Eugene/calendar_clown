import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getHistory,
  getSimplification,
  removeSimplification,
  simplifyFromApi,
} from "../../services/simplifierService.js";

const idArg = z.object({ id: z.number().int().positive() });

export const simplifierActions: Action[] = [
  defineAction({
    name: "simplifier.history", mode: "simplifier", humanTitle: "История упрощений",
    description: "Показать историю упрощений текста (пагинация limit/offset).",
    argsSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getHistory(ctx.telegramId, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "simplifier.get", mode: "simplifier", humanTitle: "Упрощение по id",
    description: "Показать упрощение по id.",
    argsSchema: idArg, mutates: false,
    handler: async (ctx, a) => {
      const res = await getSimplification(ctx.telegramId, a.id);
      if (!res) throw new Error("Упрощение не найдено.");
      return { data: res };
    },
  }),
  defineAction({
    name: "simplifier.simplify", mode: "simplifier", humanTitle: "Упростить текст",
    description: "Упростить произвольный текст через AI.",
    argsSchema: z.object({ text: z.string().min(1) }),
    mutates: true, heavy: true,
    handler: async (ctx, a) => ({ data: await simplifyFromApi(ctx.telegramId, a.text.trim()) }),
  }),
  defineAction({
    name: "simplifier.voice", mode: "simplifier", humanTitle: "Упростить голос",
    description: "Упростить текст из голосового сообщения (требуется загрузка аудио).",
    argsSchema: z.object({}), mutates: true, heavy: true, requiresUI: "file",
    handler: async () => { throw new Error("Упрощение голоса доступно только через Mini App."); },
  }),
  defineAction({
    name: "simplifier.delete", mode: "simplifier", humanTitle: "Удалить упрощение",
    description: "Удалить упрощение по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeSimplification(ctx.telegramId, a.id), id: a.id } }),
  }),
];
