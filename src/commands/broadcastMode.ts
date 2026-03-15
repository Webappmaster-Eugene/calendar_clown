import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/expenseMode.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { broadcastToTribe, formatBroadcastResult } from "../broadcast/service.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";

export async function handleBroadcastCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isBootstrapAdmin(telegramId)) {
    await ctx.reply("Рассылка доступна только администратору.");
    return;
  }

  // Answer callback query if triggered from inline button
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery("📢 Рассылка");
  }

  await setUserMode(telegramId, "broadcast");
  await setModeMenuCommands(ctx, "broadcast");

  await ctx.reply(
    "📢 *Режим рассылки активирован*\n\n" +
    "Отправьте текстовое или голосовое сообщение — оно будет разослано всем пользователям.\n\n" +
    "Для выхода переключитесь в другой режим.",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard(getModeButtons(true)).resize(),
    }
  );
}

export async function handleBroadcastText(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isBootstrapAdmin(telegramId)) {
    await ctx.reply("Рассылка доступна только администратору.");
    return;
  }

  const message = ctx.message && "text" in ctx.message ? ctx.message.text : null;
  if (!message) return;

  const sendMessage = async (recipientId: string, text: string): Promise<void> => {
    await ctx.telegram.sendMessage(recipientId, text);
  };

  try {
    const result = await broadcastToTribe(sendMessage, telegramId, message);
    await ctx.reply(formatBroadcastResult(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка рассылки";
    await ctx.reply(msg);
  }
}
