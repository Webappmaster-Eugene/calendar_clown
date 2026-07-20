import type { Context } from "telegraf";
import { getUserMenuContext } from "../middleware/auth.js";
import { routeDo } from "../actions/router.js";
import { executeAction, ActionError } from "../actions/guard.js";
import { getAction } from "../actions/registry.js";
import { renderResult } from "../actions/render.js";
import type { Action, ActionCtx } from "../actions/types.js";
import { splitMessage } from "../utils/telegram.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("do");

interface Pending {
  actionName: string;
  args: unknown;
  json: boolean;
  at: number;
}
const PENDING_TTL_MS = 2 * 60_000;
const pending = new Map<number, Pending>();

const UI_HINTS: Record<string, string> = {
  photo: "Для этого нужно прислать фото в соответствующем режиме (Mini App или чат).",
  file: "Для этого нужно загрузить файл в Mini App.",
  auth: "Нужна авторизация — откройте соответствующий режим в Mini App.",
  stream: "Ответ приходит потоково — используйте режим чата в боте или Mini App.",
};

async function safeReply(ctx: Context, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    try {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(chunk);
    }
  }
}

async function runAndReply(ctx: Context, actx: ActionCtx, action: Action, args: unknown, json: boolean): Promise<void> {
  try {
    const result = await executeAction(action, actx, args);
    await safeReply(ctx, renderResult(action, result, { json }));
  } catch (err) {
    if (err instanceof ActionError) {
      await ctx.reply(`⚠️ ${err.message}`);
    } else {
      log.error("action failed", { action: action.name, error: err instanceof Error ? err.message : String(err) });
      await ctx.reply(`⚠️ ${err instanceof Error ? err.message : "Не удалось выполнить действие."}`);
    }
  }
}

export async function handleDo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const msg = ctx.message && "text" in ctx.message ? ctx.message.text : "";
  const raw = msg.replace(/^\/do(@\w+)?\s*/i, "").trim();
  const json = /(^|\s)--json(\s|$)/.test(raw);
  const text = raw.replace(/(^|\s)--json(\s|$)/g, " ").trim();

  const menu = await getUserMenuContext(telegramId);
  if (!menu) {
    await ctx.reply("Нет доступа. Пройдите онбординг через /start.");
    return;
  }
  const actx: ActionCtx = { telegramId, menu };

  if (/^(yes|да|ок|ок\.|подтверждаю)$/i.test(text)) {
    const p = pending.get(telegramId);
    if (!p || Date.now() - p.at > PENDING_TTL_MS) {
      pending.delete(telegramId);
      await ctx.reply("Нет ожидающего подтверждения действия.");
      return;
    }
    pending.delete(telegramId);
    const action = getAction(p.actionName);
    if (!action) {
      await ctx.reply("Действие больше недоступно.");
      return;
    }
    await runAndReply(ctx, actx, action, p.args, p.json);
    return;
  }
  if (/^(no|нет|отмена|cancel)$/i.test(text)) {
    pending.delete(telegramId);
    await ctx.reply("Отменено.");
    return;
  }

  if (!text) {
    await ctx.reply('Напишите: /do <что сделать>. Пример: /do создай напоминание пить воду каждый день в 10:00');
    return;
  }

  await ctx.sendChatAction("typing").catch(() => {});
  const outcome = await routeDo(text, menu);

  if (outcome.kind === "no_action") {
    await ctx.reply(`🤔 ${outcome.reason} Переформулируйте или уточните режим.`);
    return;
  }
  if (outcome.kind === "invalid_args") {
    await ctx.reply(`Не хватает данных для «${outcome.action.humanTitle}»: ${outcome.reason}`);
    return;
  }

  const { action, args } = outcome;

  if (action.requiresUI) {
    await ctx.reply(`ℹ️ «${action.humanTitle}»: ${UI_HINTS[action.requiresUI] ?? "требуется интерфейс Mini App."}`);
    return;
  }

  if (action.mutates) {
    pending.set(telegramId, { actionName: action.name, args, json, at: Date.now() });
    await safeReply(
      ctx,
      `Подтвердите действие: *${action.humanTitle}*\n\`${JSON.stringify(args)}\`\n\nОтправьте /do да — выполнить, /do нет — отменить.`,
    );
    return;
  }

  await runAndReply(ctx, actx, action, args, json);
}
