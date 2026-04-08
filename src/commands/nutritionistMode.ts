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
  saveManualCalculation,
} from "../services/nutritionistService.js";
import { TIMEZONE_MSK } from "../constants.js";
import type {
  NutritionAnalysisDto,
  NutritionFoodItemDto,
  NutritionProductDto,
  NutritionProductUnit,
  ManualCalcItemInput,
} from "../shared/types.js";

const log = createLogger("nutritionist-mode");

const HISTORY_PAGE_SIZE = 5;
const PRODUCTS_PAGE_SIZE = 5;
const CALC_PICKER_PAGE_SIZE = 8;

// ─── Sub-Mode State ─────────────────────────────────────────────

type NutritionistSubMode = "analysis" | "catalog" | "calculator";
const nutritionistSubModes = new Map<number, NutritionistSubMode>();

// ─── Calculator State Machine ───────────────────────────────────

interface CalculatorItem {
  name: string;
  weightG: number;
  caloriesPer100: number;
  proteinsPer100G: number;
  fatsPer100G: number;
  carbsPer100G: number;
  catalogProductId?: number;
}

interface ManualItemWizard {
  step: "name" | "weight" | "calories" | "proteins" | "fats" | "carbs";
  name?: string;
  weightG?: number;
  caloriesPer100?: number;
  proteinsPer100G?: number;
  fatsPer100G?: number;
}

interface CalculatorState {
  mealName: string;
  items: CalculatorItem[];
  servings: number;
  addingItem: ManualItemWizard | null;
  catalogPickedProduct: NutritionProductDto | null;
  pendingInput: "meal_name" | "servings" | null;
}

const calculatorStates = new Map<number, CalculatorState>();

function getOrCreateCalculatorState(telegramId: number): CalculatorState {
  let state = calculatorStates.get(telegramId);
  if (!state) {
    state = {
      mealName: "Ручной расчёт",
      items: [],
      servings: 1,
      addingItem: null,
      catalogPickedProduct: null,
      pendingInput: null,
    };
    calculatorStates.set(telegramId, state);
  }
  return state;
}

function hasCalculatorFlowInProgress(telegramId: number): boolean {
  const state = calculatorStates.get(telegramId);
  if (!state) return false;
  return state.addingItem !== null || state.catalogPickedProduct !== null || state.pendingInput !== null;
}

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

// ─── Keyboards ─────────────────────────────────────────────────

const SUB_MODE_ROW = ["📷 Анализ", "📦 Каталог", "🧮 Калькулятор"];

function getAnalysisKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📊 За сегодня", "📋 История"],
    SUB_MODE_ROW,
    ...getModeButtons(isAdmin),
  ]).resize();
}

function getCatalogKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["📦 Продукты"],
    SUB_MODE_ROW,
    ...getModeButtons(isAdmin),
  ]).resize();
}

function getCalculatorKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["➕ Добавить вручную", "📦 Из каталога"],
    ["📊 Итого", "💾 Сохранить"],
    SUB_MODE_ROW,
    ...getModeButtons(isAdmin),
  ]).resize();
}

function getKeyboardForSubMode(subMode: NutritionistSubMode, isAdmin: boolean) {
  switch (subMode) {
    case "analysis": return getAnalysisKeyboard(isAdmin);
    case "catalog": return getCatalogKeyboard(isAdmin);
    case "calculator": return getCalculatorKeyboard(isAdmin);
  }
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
  nutritionistSubModes.set(telegramId, "analysis");

  const isAdmin = isBootstrapAdmin(telegramId);

  await ctx.reply(
    "🥗 *Режим Нутрициолог активирован*\n\n" +
    "📷 *Анализ* — отправьте фото еды для оценки КБЖУ\n" +
    "📦 *Каталог* — ваши продукты с точными данными\n" +
    "🧮 *Калькулятор* — ручной расчёт КБЖУ по продуктам\n\n" +
    "Выберите раздел на клавиатуре.",
    { parse_mode: "Markdown", ...getAnalysisKeyboard(isAdmin) },
  );
}

// ─── Sub-Mode Switching ─────────────────────────────────────────

export async function handleNutritionistSubModeSwitch(
  ctx: Context,
  subMode: NutritionistSubMode,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  // Cancel any active text-input wizards when switching sub-modes
  productCreationStates.delete(telegramId);
  productEditStates.delete(telegramId);
  const calcState = calculatorStates.get(telegramId);
  if (calcState) {
    calcState.addingItem = null;
    calcState.catalogPickedProduct = null;
    calcState.pendingInput = null;
  }

  nutritionistSubModes.set(telegramId, subMode);
  const isAdmin = isBootstrapAdmin(telegramId);
  const keyboard = getKeyboardForSubMode(subMode, isAdmin);

  switch (subMode) {
    case "analysis":
      await ctx.reply(
        "📷 *Анализ*\n\nОтправьте фото еды — я определю продукты, вес порции, КБЖУ.\n" +
        "Можно добавить подпись для уточнения (например, «это борщ»).",
        { parse_mode: "Markdown", ...keyboard },
      );
      break;
    case "catalog":
      await ctx.reply(
        "📦 *Каталог продуктов*\n\nДобавляйте продукты с точными данными КБЖУ — AI будет использовать их при анализе фото.",
        { parse_mode: "Markdown", ...keyboard },
      );
      break;
    case "calculator": {
      const state = getOrCreateCalculatorState(telegramId);
      const itemsInfo = state.items.length > 0
        ? `\n\n📋 В расчёте: ${state.items.length} продукт(ов)`
        : "";
      await ctx.reply(
        "🧮 *Калькулятор КБЖУ*\n\n" +
        "Добавляйте продукты вручную или из каталога, укажите вес — " +
        "калькулятор рассчитает итоговые КБЖУ." + itemsInfo,
        { parse_mode: "Markdown", ...keyboard },
      );
      break;
    }
  }
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
  if (telegramId == null) return false;

  // 1. Product creation/edit state machine takes priority.
  if (hasProductFlowInProgress(telegramId)) {
    return handleProductFlowText(ctx, telegramId);
  }

  // 2. Calculator flow (adding item, catalog weight, meal name, servings)
  if (hasCalculatorFlowInProgress(telegramId)) {
    return handleCalculatorFlowText(ctx, telegramId);
  }

  // 3. Default hint per sub-mode
  const subMode = nutritionistSubModes.get(telegramId) ?? "analysis";
  if (subMode === "calculator") {
    await ctx.reply("🧮 Используйте кнопки клавиатуры для работы с калькулятором.");
    return true;
  }
  if (subMode === "catalog") {
    await ctx.reply("📦 Нажмите «Продукты» для управления каталогом.");
    return true;
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

  // Calculator callbacks (nutri_calc_*)
  if (data.startsWith("nutri_calc")) {
    const handled = await handleCalculatorCallback(ctx, data, telegramId);
    if (handled) return;
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
async function safeReplyMarkdown(ctx: Context, text: string, extra?: object): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: "Markdown", ...extra });
  } catch {
    // Strip markdown formatting if Telegram rejects it (special chars in food names)
    await ctx.reply(text.replace(/[*_`\[\]\\]/g, ""), extra);
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

// ─── Calculator: Button Handlers ────────────────────────────────

export async function handleCalcAddManual(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  if (!isDatabaseAvailable()) { await ctx.reply(DB_UNAVAILABLE_MSG); return; }

  const state = getOrCreateCalculatorState(telegramId);
  // Cancel any other active input
  state.catalogPickedProduct = null;
  state.pendingInput = null;
  state.addingItem = { step: "name" };
  calculatorStates.set(telegramId, state);

  await ctx.reply(
    "✏️ *Добавление продукта вручную*\n\nВведите *название* продукта:\n\nДля отмены отправьте ❌",
    { parse_mode: "Markdown" },
  );
}

export async function handleCalcAddFromCatalog(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  if (!isDatabaseAvailable()) { await ctx.reply(DB_UNAVAILABLE_MSG); return; }

  const state = getOrCreateCalculatorState(telegramId);
  // Cancel any other active input
  state.addingItem = null;
  state.pendingInput = null;
  state.catalogPickedProduct = null;
  calculatorStates.set(telegramId, state);

  await sendCalcProductPicker(ctx, telegramId, 0);
}

export async function handleCalcShowTotals(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const state = calculatorStates.get(telegramId);
  if (!state || state.items.length === 0) {
    await ctx.reply("🧮 Калькулятор пуст. Добавьте продукты кнопками «Добавить вручную» или «Из каталога».");
    return;
  }

  const text = formatCalculatorTotals(state);
  const inlineRows = buildCalcTotalsInlineKeyboard(state);
  await safeReplyMarkdown(ctx, text, inlineRows.length > 0 ? Markup.inlineKeyboard(inlineRows) : undefined);
}

export async function handleCalcSave(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  if (!isDatabaseAvailable()) { await ctx.reply(DB_UNAVAILABLE_MSG); return; }

  const state = calculatorStates.get(telegramId);
  if (!state || state.items.length === 0) {
    await ctx.reply("⚠️ Нечего сохранять. Добавьте хотя бы один продукт.");
    return;
  }

  try {
    const items: ManualCalcItemInput[] = state.items.map((item) => ({
      name: item.name,
      weightG: item.weightG,
      caloriesPer100: item.caloriesPer100,
      proteinsPer100G: item.proteinsPer100G,
      fatsPer100G: item.fatsPer100G,
      carbsPer100G: item.carbsPer100G,
      ...(item.catalogProductId !== undefined ? { catalogProductId: item.catalogProductId } : {}),
    }));

    const result = await saveManualCalculation(telegramId, {
      mealName: state.mealName,
      items,
      servings: state.servings,
    });

    calculatorStates.delete(telegramId);

    logAction(null, telegramId, "nutritionist_manual_calc", {
      mealName: state.mealName,
      itemsCount: items.length,
      servings: state.servings,
      calories: result.total.calories,
    });

    const text = formatAnalysisMessage(result);
    await safeReplyMarkdown(ctx, "✅ Расчёт сохранён и добавлен в историю.\n\n" + text);
  } catch (err) {
    log.error("Error saving manual calculation:", err);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "Ошибка сохранения расчёта."}`);
  }
}

// ─── Calculator: Text Flow ──────────────────────────────────────

async function handleCalculatorFlowText(ctx: Context, telegramId: number): Promise<boolean> {
  const message = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() ?? "" : "";
  if (!message) return false;

  const state = calculatorStates.get(telegramId);
  if (!state) return false;

  // Universal cancel
  if (message === "❌" || message === "❌ Отмена") {
    state.addingItem = null;
    state.catalogPickedProduct = null;
    state.pendingInput = null;
    await ctx.reply("❌ Отменено.");
    return true;
  }

  // ── Meal name input ──
  if (state.pendingInput === "meal_name") {
    state.mealName = message.slice(0, 200);
    state.pendingInput = null;
    await ctx.reply(`✅ Название блюда: *${escMd(state.mealName)}*`, { parse_mode: "Markdown" });
    return true;
  }

  // ── Servings input ──
  if (state.pendingInput === "servings") {
    const num = parseInt(message, 10);
    if (!Number.isInteger(num) || num < 1 || num > 999) {
      await ctx.reply("⚠️ Введите целое число от 1 до 999.");
      return true;
    }
    state.servings = num;
    state.pendingInput = null;
    await ctx.reply(`✅ Порции: ${num}`);
    return true;
  }

  // ── Catalog picked product — waiting for weight ──
  if (state.catalogPickedProduct) {
    const weight = parseWeight(message);
    if (weight === null) {
      await ctx.reply("⚠️ Введите вес в граммах (число от 0.1 до 10000).");
      return true;
    }
    const p = state.catalogPickedProduct;
    state.items.push({
      name: p.name,
      weightG: weight,
      caloriesPer100: p.caloriesPer100,
      proteinsPer100G: p.proteinsPer100G,
      fatsPer100G: p.fatsPer100G,
      carbsPer100G: p.carbsPer100G,
      catalogProductId: p.id,
    });
    state.catalogPickedProduct = null;
    await replyItemAdded(ctx, state);
    return true;
  }

  // ── Manual item wizard ──
  const wizard = state.addingItem;
  if (!wizard) return false;

  switch (wizard.step) {
    case "name": {
      if (message.length > 200) {
        await ctx.reply("⚠️ Название слишком длинное (макс. 200 символов).");
        return true;
      }
      wizard.name = message;
      wizard.step = "weight";
      await ctx.reply("⚖️ Введите *вес* в граммах:", { parse_mode: "Markdown" });
      return true;
    }
    case "weight": {
      const weight = parseWeight(message);
      if (weight === null) {
        await ctx.reply("⚠️ Введите вес в граммах (число от 0.1 до 10000).");
        return true;
      }
      wizard.weightG = weight;
      wizard.step = "calories";
      await ctx.reply("🔥 Введите *калории на 100г* (0–900):", { parse_mode: "Markdown" });
      return true;
    }
    case "calories": {
      const v = parseMacroNumber(message, 0, 900);
      if (v === null) {
        await ctx.reply("⚠️ Введите число от 0 до 900.");
        return true;
      }
      wizard.caloriesPer100 = v;
      wizard.step = "proteins";
      await ctx.reply("🥩 Введите *белки на 100г* (0–100):", { parse_mode: "Markdown" });
      return true;
    }
    case "proteins": {
      const v = parseMacroNumber(message, 0, 100);
      if (v === null) {
        await ctx.reply("⚠️ Введите число от 0 до 100.");
        return true;
      }
      wizard.proteinsPer100G = v;
      wizard.step = "fats";
      await ctx.reply("🧈 Введите *жиры на 100г* (0–100):", { parse_mode: "Markdown" });
      return true;
    }
    case "fats": {
      const v = parseMacroNumber(message, 0, 100);
      if (v === null) {
        await ctx.reply("⚠️ Введите число от 0 до 100.");
        return true;
      }
      wizard.fatsPer100G = v;
      wizard.step = "carbs";
      await ctx.reply("🍞 Введите *углеводы на 100г* (0–100):", { parse_mode: "Markdown" });
      return true;
    }
    case "carbs": {
      const v = parseMacroNumber(message, 0, 100);
      if (v === null) {
        await ctx.reply("⚠️ Введите число от 0 до 100.");
        return true;
      }
      state.items.push({
        name: wizard.name!,
        weightG: wizard.weightG!,
        caloriesPer100: wizard.caloriesPer100!,
        proteinsPer100G: wizard.proteinsPer100G!,
        fatsPer100G: wizard.fatsPer100G!,
        carbsPer100G: v,
      });
      state.addingItem = null;
      await replyItemAdded(ctx, state);
      return true;
    }
  }

  return false;
}

function parseWeight(raw: string): number | null {
  const normalized = raw.replace(",", ".").trim();
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  if (num < 0.1 || num > 10000) return null;
  return Math.round(num * 10) / 10;
}

async function replyItemAdded(ctx: Context, state: CalculatorState): Promise<void> {
  const item = state.items[state.items.length - 1];
  const factor = item.weightG / 100;
  const cal = Math.round(item.caloriesPer100 * factor);
  const badge = item.catalogProductId ? " 🎯" : "";

  await safeReplyMarkdown(ctx,
    `✅ Добавлено: *${escMd(item.name)}*${badge} — ${item.weightG}г\n` +
    `🔥 ${cal} ккал | Б ${r1(item.proteinsPer100G * factor)}г | ` +
    `Ж ${r1(item.fatsPer100G * factor)}г | У ${r1(item.carbsPer100G * factor)}г\n\n` +
    `📋 Всего продуктов: ${state.items.length}`,
  );
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Calculator: Formatting ─────────────────────────────────────

function formatCalculatorTotals(state: CalculatorState): string {
  const lines: string[] = [];
  lines.push("🧮 *Калькулятор КБЖУ*\n");

  const nameInfo = state.mealName !== "Ручной расчёт" ? state.mealName : "Ручной расчёт";
  const servingsInfo = state.servings > 1 ? ` | Порции: ${state.servings}` : "";
  lines.push(`*Блюдо:* ${escMd(nameInfo)}${servingsInfo}\n`);

  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const factor = item.weightG / 100;
    const cal = Math.round(item.caloriesPer100 * factor);
    const badge = item.catalogProductId ? " 🎯" : "";
    lines.push(
      `${i + 1}. ${escMd(item.name)}${badge} — ${item.weightG}г: ` +
      `🔥 ${cal} ккал | Б ${r1(item.proteinsPer100G * factor)}г | ` +
      `Ж ${r1(item.fatsPer100G * factor)}г | У ${r1(item.carbsPer100G * factor)}г`,
    );
  }

  // Calculate totals
  let totalWeight = 0, totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
  for (const item of state.items) {
    const factor = item.weightG / 100;
    totalWeight += item.weightG;
    totalCal += Math.round(item.caloriesPer100 * factor);
    totalP += item.proteinsPer100G * factor;
    totalF += item.fatsPer100G * factor;
    totalC += item.carbsPer100G * factor;
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━");

  if (state.servings > 1) {
    lines.push(
      `📊 *Всего (${state.servings} порц.):* ${r1(totalWeight)}г — ` +
      `🔥 ${totalCal} ккал | Б ${r1(totalP)}г | Ж ${r1(totalF)}г | У ${r1(totalC)}г`,
    );
    lines.push(
      `📊 *На 1 порцию:* ${r1(totalWeight / state.servings)}г — ` +
      `🔥 ${Math.round(totalCal / state.servings)} ккал | ` +
      `Б ${r1(totalP / state.servings)}г | Ж ${r1(totalF / state.servings)}г | У ${r1(totalC / state.servings)}г`,
    );
  } else {
    lines.push(
      `📊 *Итого:* ${r1(totalWeight)}г — ` +
      `🔥 ${totalCal} ккал | Б ${r1(totalP)}г | Ж ${r1(totalF)}г | У ${r1(totalC)}г`,
    );
  }

  if (state.items.some((i) => i.catalogProductId)) {
    lines.push("");
    lines.push("🎯 — продукт из каталога");
  }

  return lines.join("\n");
}

function buildCalcTotalsInlineKeyboard(state: CalculatorState) {
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Delete buttons for items (up to 4 per row)
  const deleteRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  for (let i = 0; i < state.items.length; i++) {
    deleteRow.push(Markup.button.callback(`🗑 ${i + 1}`, `nutri_calc_remove:${i}`));
    if (deleteRow.length === 4) {
      rows.push([...deleteRow]);
      deleteRow.length = 0;
    }
  }
  if (deleteRow.length > 0) rows.push(deleteRow);

  // Settings row
  rows.push([
    Markup.button.callback("📋 Название", "nutri_calc_name"),
    Markup.button.callback("🔢 Порции", "nutri_calc_servings"),
  ]);

  // Clear row
  rows.push([Markup.button.callback("🔄 Очистить всё", "nutri_calc_clear")]);

  return rows;
}

// ─── Calculator: Product Picker ─────────────────────────────────

async function sendCalcProductPicker(
  ctx: Context,
  telegramId: number,
  offset: number,
  editExisting: boolean = false,
): Promise<void> {
  const list = await listUserProducts(telegramId, CALC_PICKER_PAGE_SIZE, offset);

  if (list.total === 0) {
    const text = "📦 Каталог продуктов пуст.\n\nДобавьте продукты в разделе «📦 Каталог», затем возвращайтесь.";
    if (editExisting) {
      await ctx.editMessageText(text);
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const totalPages = Math.ceil(list.total / CALC_PICKER_PAGE_SIZE);
  const currentPage = Math.floor(offset / CALC_PICKER_PAGE_SIZE) + 1;

  const text = `📦 *Выберите продукт (${currentPage}/${totalPages}):*`;

  const inlineRows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  for (const p of list.products) {
    const label = `${p.name} (🔥${p.caloriesPer100} | Б${p.proteinsPer100G} Ж${p.fatsPer100G} У${p.carbsPer100G})`;
    // Telegram callback data max 64 bytes — use short format
    inlineRows.push([Markup.button.callback(label.slice(0, 60), `nutri_calc_pick:${p.id}`)]);
  }

  // Pagination
  const paginationRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (offset > 0) {
    paginationRow.push(Markup.button.callback("⬅️ Назад", `nutri_calc_page:${offset - CALC_PICKER_PAGE_SIZE}`));
  }
  if (offset + CALC_PICKER_PAGE_SIZE < list.total) {
    paginationRow.push(Markup.button.callback("Вперёд ➡️", `nutri_calc_page:${offset + CALC_PICKER_PAGE_SIZE}`));
  }
  if (paginationRow.length > 0) inlineRows.push(paginationRow);

  inlineRows.push([Markup.button.callback("❌ Отмена", "nutri_calc_cancel")]);

  const keyboard = Markup.inlineKeyboard(inlineRows);

  if (editExisting) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
  }
}

// ─── Calculator: Callbacks ──────────────────────────────────────

async function handleCalculatorCallback(ctx: Context, data: string, telegramId: number): Promise<boolean> {
  // Pick product: nutri_calc_pick:<id>
  const pickMatch = data.match(/^nutri_calc_pick:(\d+)$/);
  if (pickMatch) {
    const productId = parseInt(pickMatch[1], 10);
    try {
      const product = await getUserProduct(telegramId, productId);
      if (!product) {
        await ctx.answerCbQuery("Продукт не найден.");
        return true;
      }
      const state = getOrCreateCalculatorState(telegramId);
      state.addingItem = null;
      state.pendingInput = null;
      state.catalogPickedProduct = product;

      await ctx.answerCbQuery();
      await ctx.reply(
        `📦 *${escMd(product.name)}*\n` +
        `🔥 ${product.caloriesPer100} ккал | Б ${product.proteinsPer100G}г | ` +
        `Ж ${product.fatsPer100G}г | У ${product.carbsPer100G}г (на 100${product.unit})\n\n` +
        `⚖️ Введите *вес* в граммах (или ❌ для отмены):`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      log.error("Error picking product for calculator:", err);
      await ctx.answerCbQuery("Ошибка загрузки продукта.");
    }
    return true;
  }

  // Pagination: nutri_calc_page:<offset>
  const pageMatch = data.match(/^nutri_calc_page:(\d+)$/);
  if (pageMatch) {
    const offset = parseInt(pageMatch[1], 10);
    try {
      await sendCalcProductPicker(ctx, telegramId, offset, true);
    } catch (err) {
      log.error("Error paginating calculator product picker:", err);
    }
    await ctx.answerCbQuery();
    return true;
  }

  // Remove item: nutri_calc_remove:<index>
  const removeMatch = data.match(/^nutri_calc_remove:(\d+)$/);
  if (removeMatch) {
    const idx = parseInt(removeMatch[1], 10);
    const state = calculatorStates.get(telegramId);
    if (!state || idx < 0 || idx >= state.items.length) {
      await ctx.answerCbQuery("Элемент не найден.");
      return true;
    }
    const removed = state.items.splice(idx, 1)[0];
    await ctx.answerCbQuery(`Удалено: ${removed.name}`);

    if (state.items.length === 0) {
      await ctx.editMessageText("🧮 Калькулятор пуст. Добавьте продукты.");
    } else {
      const totalsText = formatCalculatorTotals(state);
      const totalsInlineRows = buildCalcTotalsInlineKeyboard(state);
      await ctx.editMessageText(totalsText, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(totalsInlineRows),
      });
    }
    return true;
  }

  // Clear all: nutri_calc_clear
  if (data === "nutri_calc_clear") {
    const state = calculatorStates.get(telegramId);
    if (state) {
      state.items = [];
      state.addingItem = null;
      state.catalogPickedProduct = null;
      state.pendingInput = null;
      state.mealName = "Ручной расчёт";
      state.servings = 1;
    }
    await ctx.answerCbQuery("Очищено");
    await ctx.editMessageText("🧮 Калькулятор очищен. Добавьте продукты.");
    return true;
  }

  // Set meal name prompt: nutri_calc_name
  if (data === "nutri_calc_name") {
    const state = getOrCreateCalculatorState(telegramId);
    state.addingItem = null;
    state.catalogPickedProduct = null;
    state.pendingInput = "meal_name";
    await ctx.answerCbQuery();
    await ctx.reply(
      `📋 Введите *название блюда* (текущее: ${escMd(state.mealName)}):\n\nДля отмены отправьте ❌`,
      { parse_mode: "Markdown" },
    );
    return true;
  }

  // Set servings prompt: nutri_calc_servings
  if (data === "nutri_calc_servings") {
    const state = getOrCreateCalculatorState(telegramId);
    state.addingItem = null;
    state.catalogPickedProduct = null;
    state.pendingInput = "servings";
    await ctx.answerCbQuery();
    await ctx.reply(
      `🔢 Введите *количество порций* (текущее: ${state.servings}):\n\nДля отмены отправьте ❌`,
      { parse_mode: "Markdown" },
    );
    return true;
  }

  // Cancel picker: nutri_calc_cancel
  if (data === "nutri_calc_cancel") {
    await ctx.answerCbQuery("Отменено");
    await ctx.editMessageText("❌ Выбор из каталога отменён.");
    return true;
  }

  return false;
}
