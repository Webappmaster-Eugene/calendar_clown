/**
 * Chat (Neuro) actions — wrappers over chatService (mirrors src/api/routes/chat.ts).
 * Individual mode. Non-streaming send only; photo/document input stays UI-only.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import {
  getUserDialogs,
  createNewDialog,
  renameUserDialog,
  removeDialog,
  getDialogMessages,
  sendMessage,
} from "../../services/chatService.js";
import { getUserByTelegramId } from "../../expenses/repository.js";
import { getChatProvider, setChatProvider } from "../../chat/repository.js";
import type { ChatProvider } from "../../shared/types.js";

const dialogIdArg = z.object({ id: z.number().int().positive() });
const provider = z.enum(["free", "paid", "uncensored"]);

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

export const chatActions: Action[] = [
  defineAction({
    name: "chat.dialogs.list", mode: "neuro", humanTitle: "Список диалогов",
    description: "Показать диалоги нейро-чата пользователя (с id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getUserDialogs(ctx.telegramId) }),
  }),
  defineAction({
    name: "chat.dialogs.create", mode: "neuro", humanTitle: "Создать диалог",
    description: "Создать новый диалог нейро-чата (опц. заголовок).",
    argsSchema: z.object({ title: z.string().min(1).optional() }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createNewDialog(ctx.telegramId, a.title?.trim()) }),
  }),
  defineAction({
    name: "chat.dialogs.rename", mode: "neuro", humanTitle: "Переименовать диалог",
    description: "Переименовать диалог по id.",
    argsSchema: z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(100) }),
    mutates: true,
    handler: async (ctx, a) => {
      await renameUserDialog(ctx.telegramId, a.id, a.title.trim());
      return { data: { id: a.id, title: a.title.trim() } };
    },
  }),
  defineAction({
    name: "chat.dialogs.delete", mode: "neuro", humanTitle: "Удалить диалог",
    description: "Удалить диалог по id.",
    argsSchema: dialogIdArg, mutates: true,
    handler: async (ctx, a) => {
      await removeDialog(ctx.telegramId, a.id);
      return { data: { deleted: true, id: a.id } };
    },
  }),
  defineAction({
    name: "chat.messages", mode: "neuro", humanTitle: "Сообщения диалога",
    description: "Показать последние сообщения диалога по id.",
    argsSchema: z.object({
      id: z.number().int().positive(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getDialogMessages(ctx.telegramId, a.id, a.limit ?? 20) }),
  }),
  defineAction({
    name: "chat.send", mode: "neuro", humanTitle: "Отправить сообщение",
    description: "Отправить сообщение в нейро-чат и получить ответ ИИ (опц. dialogId — иначе активный диалог).",
    argsSchema: z.object({
      content: z.string().min(1),
      dialogId: z.number().int().positive().optional(),
    }),
    mutates: true, heavy: true,
    handler: async (ctx, a) => ({ data: await sendMessage(ctx.telegramId, a.content.trim(), a.dialogId) }),
  }),
  defineAction({
    name: "chat.provider.get", mode: "neuro", humanTitle: "Текущий провайдер",
    description: "Показать текущего провайдера нейро-чата (free/paid/uncensored).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => {
      const dbUser = await requireDbUser(ctx.telegramId);
      return { data: { provider: await getChatProvider(dbUser.id) } };
    },
  }),
  defineAction({
    name: "chat.provider.set", mode: "neuro", humanTitle: "Выбрать провайдера",
    description: "Установить провайдера нейро-чата (free/paid/uncensored).",
    argsSchema: z.object({ provider }),
    mutates: true,
    handler: async (ctx, a) => {
      const dbUser = await requireDbUser(ctx.telegramId);
      await setChatProvider(dbUser.id, a.provider as ChatProvider);
      return { data: { provider: a.provider } };
    },
  }),
];
