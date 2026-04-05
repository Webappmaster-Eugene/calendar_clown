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
  addProduct,
  editProduct,
  removeProduct,
  listUserProducts,
  getUserProduct,
} from "../services/nutritionistService.js";
import { TIMEZONE_MSK } from "../constants.js";
import type {
  NutritionAnalysisDto,
  NutritionFoodItemDto,
  NutritionProductDto,
  NutritionProductUnit,
} from "../shared/types.js";

const log = createLogger("nutritionist-mode");

const HISTORY_PAGE_SIZE = 5;
const PRODUCTS_PAGE_SIZE = 5;

// ─── Product Catalog State Machines ─────────────────────────────
//
// Bot creation/edit of products is a multi-step text conversation. We
// keep transient state in per-user in-memory Maps — identical to the
// pattern used by gandalfMode.ts. A bot restart drops in-progress flows
// (user simply retypes); nothing is persisted until the final step.

interface ProductCreationState {
  step:
    | "name"
    | "description"
    | "unit"
    | "calories"
    | "proteins"
    | "fats"
    | "carbs"
    | "photo_or_done";
  name?: string;
  description?: string | null;
  unit?: NutritionProductUnit;
  caloriesPer100?: number;
  proteinsPer100G?: number;
  fatsPer100G?: number;
  carbsPer100G?: number;
}

type ProductEditField = "name" | "description" | "calories" | "proteins" | "fats" | "carbs";

interface ProductEditState {
  productId: number;
  field: ProductEditField;
}

const productCreationStates = new Map<number, ProductCreationState>();
const productEditStates = new Map<number, ProductEditState>();

function hasProductFlowInProgress(telegramId: number): boolean {
  return productCreationStates.has(telegramId) || productEditStates.has(telegramId);
}

// ─── Keyboard ──────────────────────────────────────────────────

function getNutritionistKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📊 За сегодня", "📋 История"],
    ["📦 Продукты"],
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

  // If the user is in the product-creation photo step, delegate the
  // incoming photo to the product flow instead of running food analysis.
  const creationState = productCreationStates.get(telegramId);
  if (creationState && creationState.step === "photo_or_done") {
    const consumed = await handleProductFlowPhoto(ctx, telegramId);
    if (consumed) return;
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
  const telegramId = ctx.from?.id;
  if (telegramId != null && hasProductFlowInProgress(telegramId)) {
    // Product creation/edit state machine takes priority.
    return handleProductFlowText(ctx, telegramId);
  }
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

  // Product catalog callbacks (nutri_prod*) take priority — their prefix
  // overlaps the nutri_ namespace but the handler returns false if the
  // callback belongs to the analysis flow below.
  if (data.startsWith("nutri_prod")) {
    const handled = await handleProductCatalogCallback(ctx, data, telegramId);
    if (handled) return;
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
    const matchedBadge = item.matchedProductId ? " 🎯" : "";
    lines.push(
      `${i + 1}. ${escMd(item.name)}${matchedBadge} (${escMd(item.cookingMethod)}) — ${item.weightG}г`,
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

  if (analysis.items.some((i) => i.matchedProductId)) {
    lines.push("");
    lines.push("🎯 — продукт из вашего каталога");
  }

  if (analysis.mealAssessment) {
    lines.push("");
    lines.push(`💡 *Оценка:* ${escMd(analysis.mealAssessment)}`);
  }

  return lines.join("\n");
}

// ─── Product Catalog: Entry Button ─────────────────────────────

export async function handleNutritionistProductsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }
  try {
    await sendProductsPage(ctx, telegramId, 0);
  } catch (err) {
    log.error("Error fetching products:", err);
    await ctx.reply("Ошибка при получении каталога продуктов.");
  }
}

// ─── Product Catalog: Callbacks ───────────────────────────────

/**
 * Extract handling of nutri_prod_* callbacks from the main callback router.
 * Returns true if the callback was consumed.
 */
async function handleProductCatalogCallback(ctx: Context, data: string, telegramId: number): Promise<boolean> {
  // List page: nutri_prod:<offset>
  const listMatch = data.match(/^nutri_prod:(\d+)$/);
  if (listMatch) {
    const offset = parseInt(listMatch[1], 10);
    try {
      await sendProductsPage(ctx, telegramId, offset, true);
    } catch (err) {
      log.error("Error paginating products:", err);
    }
    await ctx.answerCbQuery();
    return true;
  }

  if (data === "nutri_prod_new") {
    productEditStates.delete(telegramId);
    productCreationStates.set(telegramId, { step: "name" });
    await ctx.answerCbQuery();
    await ctx.reply(
      "➕ *Новый продукт*\n\nВведите *название* продукта (например, «Молоко Простоквашино 2.5%»).\n\nДля отмены отправьте ❌ Отмена.",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  const viewMatch = data.match(/^nutri_prod_view:(\d+)$/);
  if (viewMatch) {
    const id = parseInt(viewMatch[1], 10);
    try {
      const product = await getUserProduct(telegramId, id);
      if (!product) {
        await ctx.answerCbQuery("Продукт не найден.");
        return true;
      }
      await ctx.answerCbQuery();
      await ctx.reply(formatProductCard(product), {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✏️ Имя", `nutri_prod_edit:${id}:name`),
            Markup.button.callback("📝 Описание", `nutri_prod_edit:${id}:description`),
          ],
          [
            Markup.button.callback("🔥 Калории", `nutri_prod_edit:${id}:calories`),
            Markup.button.callback("🥩 Белки", `nutri_prod_edit:${id}:proteins`),
          ],
          [
            Markup.button.callback("🧈 Жиры", `nutri_prod_edit:${id}:fats`),
            Markup.button.callback("🍞 Углеводы", `nutri_prod_edit:${id}:carbs`),
          ],
          [Markup.button.callback("🗑 Удалить", `nutri_prod_del:${id}`)],
        ]),
      });
    } catch (err) {
      log.error("Error fetching product:", err);
      await ctx.answerCbQuery("Ошибка загрузки.");
    }
    return true;
  }

  const editMatch = data.match(/^nutri_prod_edit:(\d+):(name|description|calories|proteins|fats|carbs)$/);
  if (editMatch) {
    const id = parseInt(editMatch[1], 10);
    const field = editMatch[2] as ProductEditField;
    productCreationStates.delete(telegramId);
    productEditStates.set(telegramId, { productId: id, field });
    await ctx.answerCbQuery();
    await ctx.reply(
      `✏️ Введите новое значение (${editFieldLabel(field)}).\n\nДля отмены отправьте ❌ Отмена.`,
    );
    return true;
  }

  const delMatch = data.match(/^nutri_prod_del:(\d+)$/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    await ctx.editMessageText(
      `⚠️ Удалить продукт #${id} из каталога?\n\nЭто действие необратимо.`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Да, удалить", `nutri_prod_del_yes:${id}`)],
          [Markup.button.callback("❌ Отмена", `nutri_prod:0`)],
        ]),
      },
    );
    await ctx.answerCbQuery();
    return true;
  }

  const delYesMatch = data.match(/^nutri_prod_del_yes:(\d+)$/);
  if (delYesMatch) {
    const id = parseInt(delYesMatch[1], 10);
    try {
      const deleted = await removeProduct(telegramId, id);
      if (deleted) {
        await ctx.editMessageText(`✅ Продукт #${id} удалён.`);
      } else {
        await ctx.editMessageText("❌ Продукт не найден или уже удалён.");
      }
    } catch (err) {
      log.error("Error deleting product:", err);
      await ctx.editMessageText("❌ Ошибка при удалении.");
    }
    await ctx.answerCbQuery();
    return true;
  }

  const unitMatch = data.match(/^nutri_prod_unit:(g|ml)$/);
  if (unitMatch) {
    const state = productCreationStates.get(telegramId);
    if (!state || state.step !== "unit") {
      await ctx.answerCbQuery("Поток создания не активен.");
      return true;
    }
    state.unit = unitMatch[1] as NutritionProductUnit;
    state.step = "calories";
    productCreationStates.set(telegramId, state);
    await ctx.answerCbQuery();
    await ctx.reply(`🔥 Введите *калории на 100 ${state.unit}* (0–900):`, { parse_mode: "Markdown" });
    return true;
  }

  if (data === "nutri_prod_skip_photo") {
    const state = productCreationStates.get(telegramId);
    if (!state || state.step !== "photo_or_done") {
      await ctx.answerCbQuery("Поток создания не активен.");
      return true;
    }
    await ctx.answerCbQuery();
    await finalizeProductCreation(ctx, telegramId, state);
    return true;
  }

  if (data === "nutri_prod_cancel") {
    productCreationStates.delete(telegramId);
    productEditStates.delete(telegramId);
    await ctx.answerCbQuery();
    await ctx.reply("❌ Отменено.");
    return true;
  }

  return false;
}

// ─── Product Catalog: Text state machine ───────────────────────

async function handleProductFlowText(ctx: Context, telegramId: number): Promise<boolean> {
  const message = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() ?? "" : "";
  if (!message) return false;

  // Universal cancel
  if (message === "❌ Отмена") {
    productCreationStates.delete(telegramId);
    productEditStates.delete(telegramId);
    await ctx.reply("❌ Отменено.");
    return true;
  }

  // Edit flow: one-shot field update
  const editState = productEditStates.get(telegramId);
  if (editState) {
    try {
      const patch = buildEditPatch(editState.field, message);
      const updated = await editProduct(telegramId, editState.productId, patch);
      productEditStates.delete(telegramId);
      if (!updated) {
        await ctx.reply("❌ Продукт не найден.");
        return true;
      }
      await ctx.reply(`✅ Поле обновлено.\n\n${formatProductCard(updated)}`, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : "Ошибка обновления."}`);
    }
    return true;
  }

  // Creation flow
  const state = productCreationStates.get(telegramId);
  if (!state) return false;

  try {
    switch (state.step) {
      case "name": {
        if (message.length > 200) {
          await ctx.reply("⚠️ Название слишком длинное (макс. 200 символов).");
          return true;
        }
        state.name = message;
        state.step = "description";
        productCreationStates.set(telegramId, state);
        await ctx.reply("📝 Введите *описание* (или отправьте «-» чтобы пропустить):", {
          parse_mode: "Markdown",
        });
        return true;
      }
      case "description": {
        state.description = message === "-" ? null : message.slice(0, 1000);
        state.step = "unit";
        productCreationStates.set(telegramId, state);
        await ctx.reply("Выберите единицу измерения:", {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("грамм (g)", "nutri_prod_unit:g"),
              Markup.button.callback("миллилитр (ml)", "nutri_prod_unit:ml"),
            ],
            [Markup.button.callback("❌ Отмена", "nutri_prod_cancel")],
          ]),
        });
        return true;
      }
      case "unit": {
        await ctx.reply("Пожалуйста, выберите единицу кнопкой выше (g или ml).");
        return true;
      }
      case "calories": {
        const value = parseMacroNumber(message, 0, 900);
        if (value === null) {
          await ctx.reply("⚠️ Введите число от 0 до 900 (калории на 100).");
          return true;
        }
        state.caloriesPer100 = value;
        state.step = "proteins";
        productCreationStates.set(telegramId, state);
        await ctx.reply(`🥩 Введите *белки на 100 ${state.unit}* (0–100, в граммах):`, {
          parse_mode: "Markdown",
        });
        return true;
      }
      case "proteins": {
        const value = parseMacroNumber(message, 0, 100);
        if (value === null) {
          await ctx.reply("⚠️ Введите число от 0 до 100.");
          return true;
        }
        state.proteinsPer100G = value;
        state.step = "fats";
        productCreationStates.set(telegramId, state);
        await ctx.reply(`🧈 Введите *жиры на 100 ${state.unit}* (0–100, в граммах):`, {
          parse_mode: "Markdown",
        });
        return true;
      }
      case "fats": {
        const value = parseMacroNumber(message, 0, 100);
        if (value === null) {
          await ctx.reply("⚠️ Введите число от 0 до 100.");
          return true;
        }
        state.fatsPer100G = value;
        state.step = "carbs";
        productCreationStates.set(telegramId, state);
        await ctx.reply(`🍞 Введите *углеводы на 100 ${state.unit}* (0–100, в граммах):`, {
          parse_mode: "Markdown",
        });
        return true;
      }
      case "carbs": {
        const value = parseMacroNumber(message, 0, 100);
        if (value === null) {
          await ctx.reply("⚠️ Введите число от 0 до 100.");
          return true;
        }
        state.carbsPer100G = value;
        state.step = "photo_or_done";
        productCreationStates.set(telegramId, state);
        await ctx.reply(
          "📷 Отправьте фото упаковки (опционально — «для памяти») или нажмите «Пропустить».",
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback("⏭ Пропустить", "nutri_prod_skip_photo")],
              [Markup.button.callback("❌ Отмена", "nutri_prod_cancel")],
            ]),
          },
        );
        return true;
      }
      case "photo_or_done": {
        await ctx.reply("Отправьте фото упаковки или нажмите «Пропустить».");
        return true;
      }
    }
  } catch (err) {
    log.error("Error in product creation flow:", err);
    productCreationStates.delete(telegramId);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "Ошибка создания продукта."}`);
    return true;
  }

  return false;
}

// ─── Product Catalog: Photo handler ────────────────────────────

async function handleProductFlowPhoto(ctx: Context, telegramId: number): Promise<boolean> {
  const state = productCreationStates.get(telegramId);
  if (!state || state.step !== "photo_or_done") return false;
  if (!ctx.message || !("photo" in ctx.message) || !ctx.message.photo?.length) return false;

  const photos = ctx.message.photo;
  const photo = photos[photos.length - 1];
  const fileSize = photo.file_size ?? 0;
  if (fileSize > 10 * 1024 * 1024) {
    await ctx.reply("⚠️ Фото слишком большое (макс. 10 МБ).");
    return true;
  }

  try {
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Не удалось скачать фото: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    await finalizeProductCreation(ctx, telegramId, state, buffer, "image/jpeg", photo.file_id);
  } catch (err) {
    log.error("Error downloading package photo:", err);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "Ошибка загрузки фото."}`);
  }
  return true;
}

async function finalizeProductCreation(
  ctx: Context,
  telegramId: number,
  state: ProductCreationState,
  photoBuffer?: Buffer,
  photoMime?: string,
  telegramFileId?: string | null,
): Promise<void> {
  if (
    !state.name ||
    !state.unit ||
    state.caloriesPer100 === undefined ||
    state.proteinsPer100G === undefined ||
    state.fatsPer100G === undefined ||
    state.carbsPer100G === undefined
  ) {
    productCreationStates.delete(telegramId);
    await ctx.reply("❌ Неполные данные. Начните заново.");
    return;
  }
  try {
    const product = await addProduct(
      telegramId,
      {
        name: state.name,
        description: state.description ?? null,
        unit: state.unit,
        caloriesPer100: state.caloriesPer100,
        proteinsPer100G: state.proteinsPer100G,
        fatsPer100G: state.fatsPer100G,
        carbsPer100G: state.carbsPer100G,
      },
      photoBuffer,
      photoMime,
      telegramFileId ?? null,
    );
    productCreationStates.delete(telegramId);
    await ctx.reply(`✅ Продукт добавлен в каталог.\n\n${formatProductCard(product)}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    productCreationStates.delete(telegramId);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "Ошибка создания продукта."}`);
  }
}

// ─── Product Catalog: Helpers ──────────────────────────────────

function parseMacroNumber(raw: string, min: number, max: number): number | null {
  const normalized = raw.replace(",", ".").trim();
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  if (num < min || num > max) return null;
  return Math.round(num * 100) / 100;
}

function editFieldLabel(field: ProductEditField): string {
  switch (field) {
    case "name": return "название";
    case "description": return "описание, «-» чтобы очистить";
    case "calories": return "калории на 100, число 0–900";
    case "proteins": return "белки на 100, число 0–100";
    case "fats": return "жиры на 100, число 0–100";
    case "carbs": return "углеводы на 100, число 0–100";
  }
}

function buildEditPatch(field: ProductEditField, raw: string): Parameters<typeof editProduct>[2] {
  switch (field) {
    case "name":
      return { name: raw };
    case "description":
      return { description: raw === "-" ? null : raw };
    case "calories": {
      const v = parseMacroNumber(raw, 0, 900);
      if (v === null) throw new Error("Введите число от 0 до 900.");
      return { caloriesPer100: v };
    }
    case "proteins": {
      const v = parseMacroNumber(raw, 0, 100);
      if (v === null) throw new Error("Введите число от 0 до 100.");
      return { proteinsPer100G: v };
    }
    case "fats": {
      const v = parseMacroNumber(raw, 0, 100);
      if (v === null) throw new Error("Введите число от 0 до 100.");
      return { fatsPer100G: v };
    }
    case "carbs": {
      const v = parseMacroNumber(raw, 0, 100);
      if (v === null) throw new Error("Введите число от 0 до 100.");
      return { carbsPer100G: v };
    }
  }
}

function formatProductCard(p: NutritionProductDto): string {
  const lines: string[] = [];
  lines.push(`📦 *${escMd(p.name)}*`);
  if (p.description) {
    lines.push(`_${escMd(p.description)}_`);
  }
  lines.push("");
  lines.push(`На 100 ${p.unit}:`);
  lines.push(`🔥 ${p.caloriesPer100} ккал`);
  lines.push(`🥩 Б ${p.proteinsPer100G}г · 🧈 Ж ${p.fatsPer100G}г · 🍞 У ${p.carbsPer100G}г`);
  if (p.hasPackagePhoto) {
    lines.push("");
    lines.push("📷 Фото упаковки сохранено");
  }
  return lines.join("\n");
}

async function sendProductsPage(
  ctx: Context,
  telegramId: number,
  offset: number,
  editExisting: boolean = false,
): Promise<void> {
  const list = await listUserProducts(telegramId, PRODUCTS_PAGE_SIZE, offset);

  if (list.total === 0) {
    const text = "📦 *Каталог продуктов пуст*\n\nДобавьте свои продукты, чтобы AI использовал точные калории при анализе блюд.";
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("➕ Новый продукт", "nutri_prod_new")],
    ]);
    if (editExisting) {
      await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
    }
    return;
  }

  const totalPages = Math.ceil(list.total / PRODUCTS_PAGE_SIZE);
  const currentPage = Math.floor(offset / PRODUCTS_PAGE_SIZE) + 1;

  const lines = list.products.map((p, i) => {
    const num = offset + i + 1;
    return (
      `*${num}.* ${escMd(p.name)} (${p.unit})\n` +
      `   🔥 ${p.caloriesPer100} ккал | Б ${p.proteinsPer100G} · Ж ${p.fatsPer100G} · У ${p.carbsPer100G}`
    );
  });

  const text =
    `📦 *Каталог продуктов (${currentPage}/${totalPages}, всего ${list.total}/${list.maxAllowed}):*\n\n` +
    lines.join("\n\n");

  const inlineRows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  for (let i = 0; i < list.products.length; i++) {
    const p = list.products[i];
    const num = offset + i + 1;
    inlineRows.push([
      Markup.button.callback(`📖 #${num}`, `nutri_prod_view:${p.id}`),
      Markup.button.callback(`🗑 #${num}`, `nutri_prod_del:${p.id}`),
    ]);
  }

  const paginationRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    paginationRow.push(
      Markup.button.callback("⬅️ Назад", `nutri_prod:${offset - PRODUCTS_PAGE_SIZE}`),
    );
  }
  if (offset + PRODUCTS_PAGE_SIZE < list.total) {
    paginationRow.push(
      Markup.button.callback("Вперёд ➡️", `nutri_prod:${offset + PRODUCTS_PAGE_SIZE}`),
    );
  }
  if (paginationRow.length > 0) inlineRows.push(paginationRow);

  inlineRows.push([Markup.button.callback("➕ Новый продукт", "nutri_prod_new")]);

  const keyboard = Markup.inlineKeyboard(inlineRows);

  if (editExisting) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
  }
}
