/**
 * Nutritionist mode command handler.
 * User sends a food photo → AI analyzes it → returns nutrition breakdown.
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { ensureUser } from "../expenses/repository.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { getModeButtons, setModeMenuCommands, DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import {
  analyzePhoto,
  getHistory,
  getDailySummary,
  removeAnalysis,
  getAnalysis,
} from "../services/nutritionistService.js";
import { TIMEZONE_MSK } from "../constants.js";
import type { NutritionAnalysisDto, NutritionFoodItemDto } from "../shared/types.js";

const log = createLogger("nutritionist-mode");

const HISTORY_PAGE_SIZE = 5;

// ─── Keyboard ──────────────────────────────────────────────────

function getNutritionistKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📊 За сегодня", "📋 История"],
    ...getModeButtons(isAdmin),
  ]).resize();
}

// ─── Main Command ──────────────────────────────────────────────

export async function handleNutritionistCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  await ensureUser(
    telegramId,
    ctx.from?.username ?? null,
    ctx.from?.first_name ?? "",
    ctx.from?.last_name ?? null,
    isBootstrapAdmin(telegramId),
  );

  await setUserMode(telegramId, "nutritionist");
  await setModeMenuCommands(ctx, "nutritionist");

  const isAdmin = isBootstrapAdmin(telegramId);

  await ctx.reply(
    "🥗 *Режим Нутрициолог активирован*\n\n" +
    "Отправьте *фотографию еды* — я определю продукты, оценю вес порции, калорийность и содержание БЖУ.\n\n" +
    "Можно добавить подпись к фото для уточнения (например, «это борщ»).\n\n" +
    "Поддерживаются форматы: JPG, PNG, WebP, HEIC.",
    { parse_mode: "Markdown", ...getNutritionistKeyboard(isAdmin) },
  );
}

// ─── Photo handler ─────────────────────────────────────────────

export async function handleNutritionistPhoto(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  if (!ctx.message || !("photo" in ctx.message) || !ctx.message.photo?.length) return;

  const photos = ctx.message.photo;
  const photo = photos[photos.length - 1]; // Largest resolution

  // Check photo file size (Telegram photos can be up to 20MB)
  const fileSize = photo.file_size ?? 0;
  if (fileSize > 15 * 1024 * 1024) {
    await ctx.reply("⚠️ Фото слишком большое (макс. 15 МБ). Отправьте фото меньшего размера.");
    return;
  }

  const caption = ("caption" in ctx.message ? ctx.message.caption : null) ?? null;

  await ctx.sendChatAction("typing");
  const statusMsg = await ctx.reply("🔍 Анализирую еду на фото...");

  try {
    // Download photo
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Не удалось скачать фото: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Analyze
    const result = await analyzePhoto(
      telegramId,
      base64,
      "image/jpeg",
      photo.file_id,
      caption,
    );

    // Delete status message
    try {
      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch { /* ignore */ }

    // Send result
    if (result.status === "failed") {
      await ctx.reply(`❌ ${result.errorMessage ?? "Ошибка при анализе."}`);
      return;
    }

    logAction(null, telegramId, "nutritionist_photo_analyze", {
      dishType: result.dishType,
      calories: result.total.calories,
      itemsCount: result.items.length,
    });

    const text = formatAnalysisMessage(result);
    await safeReplyMarkdown(ctx, text);

    // Show daily summary inline
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE_MSK });
    const daily = await getDailySummary(telegramId, today);
    if (daily.mealsCount > 1) {
      await safeReplyMarkdown(ctx,
        `📊 *За сегодня:* ${daily.mealsCount} приёмов | ` +
        `🔥 ${daily.total.calories} ккал | ` +
        `Б ${daily.total.proteinsG}г | Ж ${daily.total.fatsG}г | У ${daily.total.carbsG}г`,
      );
    }
  } catch (err) {
    log.error("Error processing nutritionist photo:", err);
    try {
      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : "Ошибка при анализе фото.";
    await ctx.reply(`❌ ${msg}`);
  }
}

// ─── Document handler (HEIC, WebP sent as document) ────────────

export async function handleNutritionistDocument(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  if (!ctx.message || !("document" in ctx.message) || !ctx.message.document) return;

  const doc = ctx.message.document;
  const mimeType = doc.mime_type ?? "";

  // Only process image documents
  if (!mimeType.startsWith("image/")) return;

  const fileSize = doc.file_size ?? 0;
  if (fileSize > 15 * 1024 * 1024) {
    await ctx.reply("⚠️ Файл слишком большой (макс. 15 МБ). Отправьте фото меньшего размера.");
    return;
  }

  const caption = ("caption" in ctx.message ? ctx.message.caption : null) ?? null;

  await ctx.sendChatAction("typing");
  const statusMsg = await ctx.reply("🔍 Анализирую еду на фото...");

  try {
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");

    const result = await analyzePhoto(
      telegramId,
      base64,
      mimeType,
      doc.file_id,
      caption,
    );

    try {
      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch { /* ignore */ }

    if (result.status === "failed") {
      await ctx.reply(`❌ ${result.errorMessage ?? "Ошибка при анализе."}`);
      return;
    }

    logAction(null, telegramId, "nutritionist_photo_analyze", {
      dishType: result.dishType,
      calories: result.total.calories,
      itemsCount: result.items.length,
      source: "document",
    });

    const text = formatAnalysisMessage(result);
    await safeReplyMarkdown(ctx, text);

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE_MSK });
    const daily = await getDailySummary(telegramId, today);
    if (daily.mealsCount > 1) {
      await safeReplyMarkdown(ctx,
        `📊 *За сегодня:* ${daily.mealsCount} приёмов | ` +
        `🔥 ${daily.total.calories} ккал | ` +
        `Б ${daily.total.proteinsG}г | Ж ${daily.total.fatsG}г | У ${daily.total.carbsG}г`,
      );
    }
  } catch (err) {
    log.error("Error processing nutritionist document:", err);
    try {
      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : "Ошибка при анализе фото.";
    await ctx.reply(`❌ ${msg}`);
  }
}

// ─── Text handler ──────────────────────────────────────────────

export async function handleNutritionistText(ctx: Context): Promise<boolean> {
  await ctx.reply("📸 Отправьте фото еды для анализа. Можно добавить подпись к фото для уточнения.");
  return true;
}

// ─── Daily Summary button ──────────────────────────────────────

export async function handleNutritionistDailyButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  try {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE_MSK });
    const summary = await getDailySummary(telegramId, today);

    if (summary.mealsCount === 0) {
      await ctx.reply("📊 Сегодня ещё нет проанализированных приёмов пищи. Отправьте фото еды!");
      return;
    }

    const lines: string[] = [];
    lines.push("📊 *Питание за сегодня*\n");
    lines.push(`Приёмов пищи: ${summary.mealsCount}\n`);
    lines.push(`🔥 Калории: ${summary.total.calories} ккал`);
    lines.push(`🥩 Белки: ${summary.total.proteinsG}г`);
    lines.push(`🧈 Жиры: ${summary.total.fatsG}г`);
    lines.push(`🍞 Углеводы: ${summary.total.carbsG}г`);

    if (summary.analyses.length > 0) {
      lines.push("");
      for (let i = 0; i < summary.analyses.length; i++) {
        const a = summary.analyses[i];
        const time = new Date(a.createdAt).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: TIMEZONE_MSK,
        });
        lines.push(`${i + 1}. ${time} — ${a.dishType} (${a.total.calories} ккал)`);
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    log.error("Error fetching daily summary:", err);
    await ctx.reply("Ошибка при получении сводки за сегодня.");
  }
}

// ─── History button ────────────────────────────────────────────

export async function handleNutritionistHistoryButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  try {
    await sendHistoryPage(ctx, telegramId, 0);
  } catch (err) {
    log.error("Error fetching nutritionist history:", err);
    await ctx.reply("Ошибка при получении истории.");
  }
}

// ─── History callbacks ─────────────────────────────────────────

export async function handleNutritionistCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  // Pagination: nutri_hist:<offset>
  const histMatch = data.match(/^nutri_hist:(\d+)$/);
  if (histMatch) {
    const offset = parseInt(histMatch[1], 10);
    try {
      await sendHistoryPage(ctx, telegramId, offset, true);
    } catch (err) {
      log.error("Error in nutritionist history pagination:", err);
    }
    await ctx.answerCbQuery();
    return;
  }

  // Full view: nutri_full:<id>
  const fullMatch = data.match(/^nutri_full:(\d+)$/);
  if (fullMatch) {
    const id = parseInt(fullMatch[1], 10);
    try {
      const analysis = await getAnalysis(telegramId, id);
      if (!analysis) {
        await ctx.answerCbQuery("Запись не найдена.");
        return;
      }
      await ctx.answerCbQuery();
      const text = formatAnalysisMessage(analysis);
      await safeReplyMarkdown(ctx, text);
    } catch (err) {
      log.error("Error fetching full nutritionist analysis:", err);
      await ctx.answerCbQuery("Ошибка загрузки.");
    }
    return;
  }

  // Delete confirm: nutri_del:<id>
  const delMatch = data.match(/^nutri_del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await ctx.editMessageText(
      `⚠️ Удалить анализ #${id}?\n\nЭто действие необратимо.`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Да, удалить", `nutri_del_yes:${id}`)],
          [Markup.button.callback("❌ Отмена", "nutri_hist:0")],
        ]),
      },
    );
    await ctx.answerCbQuery();
    return;
  }

  // Delete yes: nutri_del_yes:<id>
  const delYesMatch = data.match(/^nutri_del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    try {
      const deleted = await removeAnalysis(telegramId, id);
      if (deleted) {
        await ctx.editMessageText(`✅ Анализ #${id} удалён.`);
      } else {
        await ctx.editMessageText("❌ Запись не найдена или уже удалена.");
      }
    } catch (err) {
      log.error("Error deleting nutritionist analysis:", err);
      await ctx.editMessageText("❌ Ошибка при удалении.");
    }
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();
}

// ─── History Page ──────────────────────────────────────────────

async function sendHistoryPage(
  ctx: Context,
  telegramId: number,
  offset: number,
  editExisting: boolean = false,
): Promise<void> {
  const history = await getHistory(telegramId, HISTORY_PAGE_SIZE, offset);

  if (history.total === 0) {
    const msg = "История анализов пуста. Отправьте фото еды!";
    if (editExisting) {
      await ctx.editMessageText(msg);
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  const totalPages = Math.ceil(history.total / HISTORY_PAGE_SIZE);
  const currentPage = Math.floor(offset / HISTORY_PAGE_SIZE) + 1;

  const lines = history.analyses.map((a, i) => {
    const num = offset + i + 1;
    const date = new Date(a.createdAt).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIMEZONE_MSK,
    });
    const statusIcon = a.status === "completed" ? "✅" : a.status === "failed" ? "❌" : "⏳";
    const preview = a.status === "completed"
      ? `${a.dishType} — 🔥 ${a.total.calories} ккал`
      : a.status === "failed"
        ? `Ошибка: ${a.errorMessage ?? "неизвестная"}`
        : "Обработка...";
    return `*${num}.* ${statusIcon} ${date}\n${preview}`;
  });

  const text = `🥗 *Анализы (${currentPage}/${totalPages}, всего: ${history.total}):*\n\n${lines.join("\n\n")}`;

  const inlineRows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  for (let i = 0; i < history.analyses.length; i++) {
    const a = history.analyses[i];
    const num = offset + i + 1;
    const row: Array<ReturnType<typeof Markup.button.callback>> = [];
    if (a.status === "completed") {
      row.push(Markup.button.callback(`📖 #${num}`, `nutri_full:${a.id}`));
    }
    row.push(Markup.button.callback(`🗑 #${num}`, `nutri_del:${a.id}`));
    inlineRows.push(row);
  }

  // Pagination
  const paginationRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    paginationRow.push(Markup.button.callback("⬅️ Назад", `nutri_hist:${offset - HISTORY_PAGE_SIZE}`));
  }
  if (offset + HISTORY_PAGE_SIZE < history.total) {
    paginationRow.push(Markup.button.callback("Вперёд ➡️", `nutri_hist:${offset + HISTORY_PAGE_SIZE}`));
  }
  if (paginationRow.length > 0) {
    inlineRows.push(paginationRow);
  }

  const keyboard = inlineRows.length > 0 ? Markup.inlineKeyboard(inlineRows) : undefined;

  if (editExisting) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
  }
}

// ─── Helpers ───────────────────────────────────────────────────

/** Reply with Markdown, falling back to plain text if Markdown parsing fails. */
async function safeReplyMarkdown(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch {
    // Strip markdown formatting if Telegram rejects it (special chars in food names)
    await ctx.reply(text.replace(/[*_`\[\]\\]/g, ""));
  }
}

// ─── Formatting ─────────────────────────────────────────────────

/** Escape Markdown V1 special characters in user-facing text from AI. */
function escMd(text: string): string {
  return text.replace(/([_*`\[\]\\])/g, "\\$1");
}

function formatAnalysisMessage(analysis: NutritionAnalysisDto): string {
  if (analysis.items.length === 0) {
    return `🥗 *Анализ еды*\n\n${escMd(analysis.mealAssessment || "На фотографии не обнаружена еда.")}`;
  }

  const lines: string[] = [];
  lines.push("🥗 *Анализ еды*\n");
  lines.push(`*Блюдо:* ${escMd(analysis.dishType)}`);

  const confidenceLabel =
    analysis.confidence === "high" ? "высокая" :
    analysis.confidence === "medium" ? "средняя" : "низкая";
  lines.push(`*Уверенность:* ${confidenceLabel}\n`);

  lines.push("📦 *Продукты:*");
  analysis.items.forEach((item: NutritionFoodItemDto, i: number) => {
    lines.push(
      `${i + 1}. ${escMd(item.name)} (${escMd(item.cookingMethod)}) — ${item.weightG}г`,
    );
    lines.push(
      `   🔥 ${item.calories} ккал | Б ${item.proteinsG}г | Ж ${item.fatsG}г | У ${item.carbsG}г`,
    );
  });

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━");
  lines.push(
    `📊 *Итого:* ${analysis.total.weightG}г`,
  );
  lines.push(
    `🔥 ${analysis.total.calories} ккал | Б ${analysis.total.proteinsG}г | Ж ${analysis.total.fatsG}г | У ${analysis.total.carbsG}г`,
  );

  if (analysis.mealAssessment) {
    lines.push("");
    lines.push(`💡 *Оценка:* ${escMd(analysis.mealAssessment)}`);
  }

  return lines.join("\n");
}
