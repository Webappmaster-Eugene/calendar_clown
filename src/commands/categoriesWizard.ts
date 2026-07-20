import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "../constants.js";
import { createCategoryFromRequest, CategoryServiceError } from "../services/expenseService.js";
import { logAction } from "../logging/actionLogger.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("categories-wizard");

type WizardStep = "name" | "emoji" | "aliases" | "description" | "confirm";

interface WizardState {
  step: WizardStep;
  name: string;
  emoji?: string;
  aliases: string[];
  description?: string;
  timestamp: number;
}

const STEP_ORDER: WizardStep[] = ["name", "emoji", "aliases", "description", "confirm"];
const TTL_MS = 10 * 60 * 1000;

// Пошаговое добавление категории в чате (в дополнение к Mini App). Состояние не привязано
// к режиму — обрабатывается в bot.on("text") раньше режимных хендлеров, поэтому работает везде.
const wizardState = new Map<number, WizardState>();

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, val] of wizardState) {
    if (now - val.timestamp > TTL_MS) wizardState.delete(key);
  }
}

const SKIP_TOKENS = new Set(["-", "—", "нет", "skip", "пропустить"]);
function isSkip(text: string): boolean {
  return SKIP_TOKENS.has(text.trim().toLowerCase());
}

const cancelKb = () =>
  Markup.inlineKeyboard([[Markup.button.callback("❌ Отмена", "catwiz:cancel")]]);

const skipKb = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("⏭️ Пропустить", "catwiz:skip")],
    [Markup.button.callback("❌ Отмена", "catwiz:cancel")],
  ]);

function summary(s: WizardState): string {
  return [
    "Проверьте категорию:",
    "",
    `${s.emoji ?? "📦"} ${s.name}`,
    `Классификация: ${s.aliases.length ? s.aliases.join(", ") : "—"}`,
    `Описание: ${s.description ?? "—"}`,
  ].join("\n");
}

async function promptStep(ctx: Context, state: WizardState): Promise<void> {
  switch (state.step) {
    case "name":
      await ctx.reply("➕ Новая категория.\n\nШаг 1/4 — введите НАЗВАНИЕ:", cancelKb());
      break;
    case "emoji":
      await ctx.reply("Шаг 2/4 — отправьте ЭМОДЗИ (или пропустите):", skipKb());
      break;
    case "aliases":
      await ctx.reply(
        "Шаг 3/4 — КЛАССИФИКАЦИЯ: слова-синонимы через запятую, по ним бот распознаёт траты " +
          "(например: корм, ветеринар, зоомагазин). Или пропустите:",
        skipKb()
      );
      break;
    case "description":
      await ctx.reply(
        "Шаг 4/4 — ОПИСАНИЕ: короткая подсказка для распознавания " +
          "(например: расходы на домашних животных). Или пропустите:",
        skipKb()
      );
      break;
    case "confirm":
      await ctx.reply(
        summary(state),
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Создать", "catwiz:save")],
          [Markup.button.callback("❌ Отмена", "catwiz:cancel")],
        ])
      );
      break;
  }
}

function advance(state: WizardState): void {
  const idx = STEP_ORDER.indexOf(state.step);
  state.step = STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
  state.timestamp = Date.now();
}

export async function handleCategoriesWizardStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  if (ctx.callbackQuery) await ctx.answerCbQuery();

  if (!isBootstrapAdmin(telegramId)) {
    await ctx.reply("Управление категориями доступно только администратору.");
    return;
  }
  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  const state: WizardState = { step: "name", name: "", aliases: [], timestamp: Date.now() };
  wizardState.set(telegramId, state);
  await promptStep(ctx, state);
}

export async function handleCategoriesWizardSkip(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  const state = wizardState.get(telegramId);
  if (ctx.callbackQuery) await ctx.answerCbQuery(state ? "Пропущено" : undefined);
  if (!state) return;
  advance(state);
  await promptStep(ctx, state);
}

export async function handleCategoriesWizardCancel(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  wizardState.delete(telegramId);
  if (ctx.callbackQuery) await ctx.answerCbQuery("Отменено");
  await ctx.reply("Создание категории отменено.");
}

export async function handleCategoriesWizardSave(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;
  const state = wizardState.get(telegramId);
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  if (!state) return;

  try {
    const cat = await createCategoryFromRequest(telegramId, {
      name: state.name,
      emoji: state.emoji,
      aliases: state.aliases,
      description: state.description ?? null,
    });
    wizardState.delete(telegramId);
    logAction(null, telegramId, "expense_category_create", { name: cat.name, via: "bot_wizard" });
    await ctx.reply(
      `✅ Категория создана: ${cat.emoji} ${cat.name}\n\nТеперь бот сможет распознавать её в тратах.`
    );
  } catch (err) {
    const msg = err instanceof CategoryServiceError ? err.message : "Не удалось создать категорию.";
    await ctx.reply(`❌ ${msg}`);
    if (err instanceof CategoryServiceError && err.status === 409) {
      state.step = "name";
      state.timestamp = Date.now();
      await promptStep(ctx, state);
    } else {
      if (!(err instanceof CategoryServiceError)) log.error("Wizard save failed:", err);
      wizardState.delete(telegramId);
    }
  }
}

export async function handleCategoriesWizardText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  cleanExpired();
  const state = wizardState.get(telegramId);
  if (!state) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const text = ctx.message.text.trim();
  state.timestamp = Date.now();

  switch (state.step) {
    case "name":
      if (!text || text.length > 255) {
        await ctx.reply("❌ Название должно быть 1–255 символов. Введите ещё раз:", cancelKb());
        return true;
      }
      state.name = text;
      advance(state);
      break;
    case "emoji":
      if (!isSkip(text)) {
        if (text.length > 10) {
          await ctx.reply("❌ Слишком длинно для эмодзи. Отправьте один символ или пропустите:", skipKb());
          return true;
        }
        state.emoji = text;
      }
      advance(state);
      break;
    case "aliases":
      if (!isSkip(text)) {
        state.aliases = text.split(",").map((a) => a.trim()).filter(Boolean);
      }
      advance(state);
      break;
    case "description":
      if (!isSkip(text)) {
        if (text.length > 500) {
          await ctx.reply("❌ Описание до 500 символов. Введите короче или пропустите:", skipKb());
          return true;
        }
        state.description = text;
      }
      advance(state);
      break;
    case "confirm":
      await ctx.reply("Подтвердите кнопкой ниже: «✅ Создать» или «❌ Отмена».");
      return true;
  }

  await promptStep(ctx, state);
  return true;
}
