import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { saveMessage, getRecentMessages, clearHistory } from "../chat/repository.js";
import { chatCompletion } from "../chat/client.js";
import { splitMessage } from "../utils/telegram.js";
import { setModeMenuCommands, getModeButtons } from "./expenseMode.js";
import { DEEPSEEK_MODEL } from "../constants.js";

function getNeuroKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["🗑 Очистить историю"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

/** Handle /neuro command — enter neuro chat mode. */
export async function handleNeuroCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ Нейро-режим временно недоступен (нет подключения к базе данных).");
    return;
  }

  await setUserMode(telegramId, "neuro");
  await setModeMenuCommands(ctx, "neuro");

  const isAdmin = isBootstrapAdmin(telegramId);
  await ctx.reply(
    "🧠 *Режим Нейро активирован*\n\n" +
    "Отправьте текстовое сообщение — я отвечу с помощью AI.\n" +
    "Я помню последние 10 сообщений диалога.",
    { parse_mode: "Markdown", ...getNeuroKeyboard(isAdmin) }
  );
}

/** Handle text messages in neuro mode. Returns true if handled. */
export async function handleNeuroText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const userText = ctx.message.text;
  if (!userText) return false;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ Нейро-режим временно недоступен.");
    return true;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return false;

  try {
    await ctx.sendChatAction("typing");

    const history = await getRecentMessages(dbUser.id);
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ];

    const result = await chatCompletion(messages);

    await saveMessage(dbUser.id, "user", userText);
    await saveMessage(dbUser.id, "assistant", result.content, DEEPSEEK_MODEL, result.tokensUsed ?? undefined);

    const chunks = splitMessage(result.content);
    for (const chunk of chunks) {
      try {
        await ctx.replyWithMarkdown(chunk);
      } catch {
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    console.error("Neuro chat error:", err);
    await ctx.reply("❌ Ошибка при обработке запроса. Попробуйте позже.");
  }

  return true;
}

/** Handle "🗑 Очистить историю" button. */
export async function handleNeuroClearButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const deleted = await clearHistory(dbUser.id);
  await ctx.reply(`🗑 История очищена (удалено ${deleted} сообщений).`);
}
