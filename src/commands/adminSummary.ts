import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isDatabaseAvailable } from "../db/connection.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { DB_UNAVAILABLE_MSG } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import { BTN_BACK } from "../utils/uiKit.js";
import {
  type SummaryPeriod,
  getPeriodRange,
  collectSummaryData,
  isEmptyData,
  generateAiSummary,
  formatFallbackSummary,
} from "../services/adminSummaryService.js";

const log = createLogger("adminSummary");

// ─── Markdown safe reply ─────────────────────────────────────────────────────

async function safeMarkdownReply(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.replyWithMarkdown(text);
  } catch {
    await ctx.reply(text.replace(/[*_`\[\]\\]/g, ""));
  }
}

// ─── Period menu keyboard ────────────────────────────────────────────────────

const PERIOD_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback("📅 Сегодня", "summary:today")],
  [Markup.button.callback("⏪ Вчера", "summary:yesterday")],
  [Markup.button.callback("📆 Неделя", "summary:week")],
  [Markup.button.callback("🗓 Месяц", "summary:month")],
  [Markup.button.callback("📊 Год", "summary:year")],
  [Markup.button.callback(BTN_BACK, "admin:back")],
]);

const VALID_PERIODS = new Set<string>(["today", "yesterday", "week", "month", "year"]);

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handleSummaryCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;

  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.answerCbQuery("Доступ запрещён.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery();
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const data = ctx.callbackQuery.data;

  // summary:menu → show period selection
  if (data === "summary:menu") {
    await ctx.editMessageText("📊 *Выберите период для саммари:*", {
      parse_mode: "Markdown",
      ...PERIOD_KEYBOARD,
    });
    await ctx.answerCbQuery();
    return;
  }

  // summary:<period> → load data + AI
  const period = data.replace("summary:", "");
  if (!VALID_PERIODS.has(period)) {
    await ctx.answerCbQuery("Неизвестный период.");
    return;
  }

  await ctx.answerCbQuery();

  logAction(null, telegramId, "admin_summary_view", { period });

  const range = getPeriodRange(period as SummaryPeriod);

  try {
    await ctx.editMessageText(`⏳ Собираю данные за *${range.label}*...`, {
      parse_mode: "Markdown",
    });
  } catch {
    // message might not be editable, send new one
    await ctx.reply(`⏳ Собираю данные за *${range.label}*...`, { parse_mode: "Markdown" });
  }

  try {
    const summaryData = await collectSummaryData(range);

    if (isEmptyData(summaryData)) {
      const emptyText = `За этот период активности не обнаружено 🤷‍♂️`;
      try {
        await ctx.editMessageText(emptyText, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("⬅️ К периодам", "summary:menu")],
          ]),
        });
      } catch {
        await ctx.reply(emptyText);
      }
      return;
    }

    // Generate AI summary (with fallback)
    const resultText = await generateAiSummary(summaryData);

    try {
      await ctx.editMessageText(resultText, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⬅️ К периодам", "summary:menu")],
        ]),
      });
    } catch {
      // Markdown parse error — retry without parse_mode
      try {
        await ctx.editMessageText(resultText.replace(/[*_`\[\]\\]/g, ""), {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("⬅️ К периодам", "summary:menu")],
          ]),
        });
      } catch {
        await safeMarkdownReply(ctx, resultText);
      }
    }
  } catch (err) {
    log.error("Summary collection failed", err);
    try {
      await ctx.editMessageText("❌ Ошибка при сборе статистики.");
    } catch {
      await ctx.reply("❌ Ошибка при сборе статистики.");
    }
  }
}
