/**
 * Broadcast actions — wrapper over broadcastService (mirrors src/api/routes/broadcast.ts).
 * ADMIN mode: guard restricts to role admin; the service additionally enforces
 * isBootstrapAdmin. Sending fans out to the whole tribe → heavy.
 */
import { z } from "zod";
import { defineAction, type Action } from "../types.js";
import { sendBroadcast } from "../../services/broadcastService.js";
import { getBotSendMessage } from "../../botInstance.js";

export const broadcastActions: Action[] = [
  defineAction({
    name: "broadcast.send", mode: "broadcast", humanTitle: "Разослать сообщение",
    description: "Разослать текстовое сообщение всем участникам трайба администратора.",
    argsSchema: z.object({ text: z.string().min(1) }),
    mutates: true, heavy: true,
    handler: async (ctx, a) => {
      const botSend = getBotSendMessage();
      if (!botSend) throw new Error("Бот не инициализирован. Попробуйте позже.");
      const sendMessage = async (recipientId: string, text: string): Promise<void> => {
        await botSend(recipientId, text);
      };
      const result = await sendBroadcast(sendMessage, ctx.telegramId, a.text.trim());
      return { data: result };
    },
  }),
];
