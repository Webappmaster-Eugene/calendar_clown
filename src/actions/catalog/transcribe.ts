/**
 * Transcribe actions — wrappers over transcribeService (mirrors
 * src/api/routes/transcribe.ts). Individual mode. Audio submission stays UI-only.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getHistory,
  getTranscription,
  updateTranscript,
  removeTranscription,
  clearUserQueue,
} from "../../services/transcribeService.js";

const idArg = z.object({ id: z.number().int().positive() });
const MAX_TRANSCRIPT_LENGTH = 20_000;

export const transcribeActions: Action[] = [
  defineAction({
    name: "transcribe.history", mode: "transcribe", humanTitle: "История транскрибаций",
    description: "Показать историю транскрибаций (пагинация limit/offset).",
    argsSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getHistory(ctx.telegramId, a.limit ?? 10, a.offset ?? 0) }),
  }),
  defineAction({
    name: "transcribe.get", mode: "transcribe", humanTitle: "Транскрибация",
    description: "Показать транскрибацию по id.",
    argsSchema: idArg, mutates: false,
    handler: async (ctx, a) => {
      const t = await getTranscription(ctx.telegramId, a.id);
      if (!t) throw new Error("Транскрибация не найдена.");
      return { data: t };
    },
  }),
  defineAction({
    name: "transcribe.edit", mode: "transcribe", humanTitle: "Изменить транскрибацию",
    description: "Изменить текст транскрибации по id.",
    argsSchema: z.object({
      id: z.number().int().positive(),
      transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT_LENGTH),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const t = await updateTranscript(ctx.telegramId, a.id, a.transcript);
      if (!t) throw new Error("Транскрибация не найдена.");
      return { data: t };
    },
  }),
  defineAction({
    name: "transcribe.delete", mode: "transcribe", humanTitle: "Удалить транскрибацию",
    description: "Удалить транскрибацию по id.",
    argsSchema: idArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeTranscription(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "transcribe.queue.clear", mode: "transcribe", humanTitle: "Очистить очередь",
    description: "Очистить очередь ожидающих транскрибаций пользователя.",
    argsSchema: z.object({}), mutates: true,
    handler: async (ctx) => ({ data: { cleared: await clearUserQueue(ctx.telegramId) } }),
  }),
  defineAction({
    name: "transcribe.submit", mode: "transcribe", humanTitle: "Отправить аудио на транскрибацию",
    description: "Поставить голосовое сообщение в очередь транскрибации (требуется загрузка аудио).",
    argsSchema: z.object({}), mutates: true, requiresUI: "file",
    handler: async () => { throw new Error("Отправьте голосовое сообщение в режиме транскрибации."); },
  }),
];
