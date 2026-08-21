import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { isBootstrapAdmin, getUserMenuContext, canAccessMode } from "../middleware/auth.js";
import { formatBroadcastResult } from "../broadcast/service.js";
import { sendBroadcast, assertCanBroadcast } from "../services/broadcastService.js";
import { getModeButtons, setModeMenuCommands } from "./expenseMode.js";
import { logAction } from "../logging/actionLogger.js";
import type { BroadcastScope } from "../shared/types.js";

// Per-sender scope, chosen with the inline switch. Absent = "tribe", so a lost
// entry (restart, TTL) can only ever narrow the audience, never widen it.
const scopeBySender = new Map<number, BroadcastScope>();

export function getBroadcastScope(telegramId: number): BroadcastScope {
  return scopeBySender.get(telegramId) ?? "tribe";
}

function scopeLabel(scope: BroadcastScope): string {
  return scope === "all" ? "всем пользователям бота" : "участникам вашего трайба";
}

function scopeKeyboard(telegramId: number, scope: BroadcastScope) {
  if (!isBootstrapAdmin(telegramId)) return undefined;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${scope === "tribe" ? "✅" : "👪"} Трайбу`, "bcscope:tribe"),
      Markup.button.callback(`${scope === "all" ? "✅" : "🌍"} Всем`, "bcscope:all"),
    ],
  ]);
}

function modeText(scope: BroadcastScope): string {
  return (
    "📢 *Царская почта активирована*\n\n" +
    `Сообщение уйдёт *${scopeLabel(scope)}*.\n\n` +
    "Отправьте текстовое или голосовое сообщение.\n\n" +
    "Для выхода переключитесь в другой режим."
  );
}

export async function handleBroadcastCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const menuCtx = await getUserMenuContext(telegramId);
  if (menuCtx && !canAccessMode("broadcast", menuCtx)) {
    await ctx.reply("Рассылка доступна участникам трайба — попросите администратора добавить вас.");
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery("📢 Царская почта");
  }

  await setUserMode(telegramId, "broadcast");
  await setModeMenuCommands(ctx, "broadcast");

  const scope = getBroadcastScope(telegramId);
  await ctx.reply(modeText(scope), {
    parse_mode: "Markdown",
    ...Markup.keyboard(getModeButtons(true)).resize(),
  });

  const picker = scopeKeyboard(telegramId, scope);
  if (picker) {
    await ctx.reply("Кому рассылать:", picker);
  }
}

export async function handleBroadcastScopeToggle(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const next: BroadcastScope = data.endsWith(":all") ? "all" : "tribe";

  try {
    assertCanBroadcast(telegramId, next);
  } catch (err) {
    await ctx.answerCbQuery(err instanceof Error ? err.message : "Недоступно");
    return;
  }

  scopeBySender.set(telegramId, next);
  await ctx.answerCbQuery(`Рассылка ${scopeLabel(next)}`);
  await ctx.editMessageText("Кому рассылать:", scopeKeyboard(telegramId, next));
}

export async function handleBroadcastText(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const message = ctx.message && "text" in ctx.message ? ctx.message.text : null;
  if (!message) return;

  await deliverBroadcast(ctx, telegramId, message);
}

/** Shared by the text handler and the voice path (voiceEvent.ts). */
export async function deliverBroadcast(
  ctx: Context,
  telegramId: number,
  message: string,
): Promise<void> {
  const scope = getBroadcastScope(telegramId);
  const sendMessage = async (recipientId: string, text: string): Promise<void> => {
    await ctx.telegram.sendMessage(recipientId, text);
  };

  try {
    const result = await sendBroadcast(sendMessage, telegramId, message, scope);
    logAction(null, telegramId, "broadcast_send", {
      scope,
      sent: result.sent,
      failed: result.failed,
      messagePreview: message.slice(0, 100),
    });
    await ctx.reply(formatBroadcastResult(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка рассылки";
    await ctx.reply(msg);
  }
}
