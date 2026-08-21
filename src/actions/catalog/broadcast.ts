// The "all" scope is additionally gated by isBootstrapAdmin inside the service.
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import { sendBroadcast } from "../../services/broadcastService.js";
import { getBotSendMessage } from "../../botInstance.js";

export const broadcastActions: Action[] = [
  defineAction({
    name: "broadcast.send", mode: "broadcast", humanTitle: "Разослать сообщение",
    description:
      "Разослать текстовое сообщение участникам своего трайба (scope=tribe) " +
      "или всем пользователям бота (scope=all, только администратор).",
    argsSchema: z.object({
      text: z.string().min(1),
      scope: z.enum(["tribe", "all"]).optional(),
    }),
    mutates: true, heavy: true,
    handler: async (ctx, a) => {
      const botSend = getBotSendMessage();
      if (!botSend) throw new Error("Бот не инициализирован. Попробуйте позже.");
      const sendMessage = async (recipientId: string, text: string): Promise<void> => {
        await botSend(recipientId, text);
      };
      const result = await sendBroadcast(sendMessage, ctx.telegramId, a.text.trim(), a.scope ?? "tribe");
      return { data: result };
    },
  }),
];
