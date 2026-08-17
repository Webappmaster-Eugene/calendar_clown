import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  getActiveDialogId,
  getDialogById,
  getChatProvider,
  countDialogMessages,
  updateDialogSettings,
} from "../chat/repository.js";
import { formatEffectiveConfig } from "../chat/config.js";
import { listOpenRouterModels, vendorsOf } from "../chat/models.js";
import {
  buildPickerResults,
  buildPageData,
  buildSelectData,
  buildVendorData,
  buildVendorPageData,
  clampPage,
  formatFiltersLine,
  formatModelHint,
  formatModelLabel,
  normalizeSearchQuery,
  pageCount,
  pageSlice,
  parseSettingsCallback,
  validateDialogTitle,
  validateModelId,
  validateSystemPrompt,
  MODEL_ID_MAX,
  NEURO_SETTINGS_PREFIX,
  SYSTEM_PROMPT_MAX,
  DIALOG_TITLE_MAX,
  VENDOR_PAGE_SIZE,
  type PickerFilters,
} from "../chat/modelPicker.js";
import { cancelBatch } from "../chat/messageBatcher.js";
import { BTN_PREV, BTN_NEXT, btnBackTo, truncateText } from "../utils/uiKit.js";
import { logAction } from "../logging/actionLogger.js";
import { createLogger } from "../utils/logger.js";
import type { InlineKeyboardButton } from "telegraf/types";
import type { OpenRouterModelDto } from "../shared/types.js";

const log = createLogger("neuro-settings");

export const NEURO_SETTINGS_BUTTON = "⚙️ Настройки диалога";

type AwaitingKind = "search" | "prompt" | "title" | "modelId";

interface NeuroSettingsState {
  /** Pinned at open, so the panel never follows a dialog switch made elsewhere. */
  dialogId: number;
  panelChatId: number;
  panelMessageId: number;
  filters: PickerFilters;
  page: number;
  vendorPage: number;
  /** Snapshot of the catalog taken at open: keeps indices and pages stable even if
   *  the 1h models cache refreshes mid-session. */
  catalog: OpenRouterModelDto[] | null;
  results: OpenRouterModelDto[];
  vendors: string[];
  awaiting: AwaitingKind | null;
  timestamp: number;
}

const settingsStates = new Map<number, NeuroSettingsState>();

const SETTINGS_TTL_MS = 10 * 60 * 1000;

const EXPIRED_MSG = "Сессия настроек истекла. Откройте «⚙️ Настройки диалога» заново.";
const STALE_PANEL_MSG = "Эта панель устарела — откройте настройки заново.";
const DIALOG_GONE_MSG = "Диалог удалён. Откройте настройки заново.";

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, state] of settingsStates) {
    if (now - state.timestamp > SETTINGS_TTL_MS) settingsStates.delete(key);
  }
}

export function cancelNeuroSettings(telegramId: number): void {
  settingsStates.delete(telegramId);
}

function cb(verb: string): string {
  return `${NEURO_SETTINGS_PREFIX}${verb}`;
}

async function replyMarkdownWithFallback(
  ctx: Context,
  text: string,
  keyboard: ReturnType<typeof Markup.inlineKeyboard>
): Promise<number | null> {
  try {
    const msg = await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
    return msg.message_id;
  } catch {
    // Model ids contain "_" and "-", so Markdown parsing can fail.
    try {
      const msg = await ctx.reply(text.replace(/[*_`]/g, ""), keyboard);
      return msg.message_id;
    } catch (err) {
      log.error("Failed to send settings panel:", err);
      return null;
    }
  }
}

async function editPanel(
  ctx: Context,
  state: NeuroSettingsState,
  text: string,
  keyboard: ReturnType<typeof Markup.inlineKeyboard>
): Promise<void> {
  try {
    await ctx.telegram.editMessageText(
      state.panelChatId, state.panelMessageId, undefined, text,
      { parse_mode: "Markdown", ...keyboard }
    );
  } catch {
    try {
      await ctx.telegram.editMessageText(
        state.panelChatId, state.panelMessageId, undefined, text.replace(/[*_`]/g, ""), keyboard
      );
    } catch {
      // The panel may have been deleted by the user — send a fresh one.
      const id = await replyMarkdownWithFallback(ctx, text, keyboard);
      if (id != null) state.panelMessageId = id;
    }
  }
}

// ─── Root panel ─────────────────────────────────────────────────────────────

async function buildRootPanel(
  dbUserId: number,
  dialogId: number
): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null> {
  const dialog = await getDialogById(dialogId, dbUserId);
  if (!dialog) return null;

  const provider = await getChatProvider(dbUserId);
  const messageCount = await countDialogMessages(dialogId);

  const text =
    `⚙️ *Настройки диалога* «${truncateText(dialog.title, 60)}»\n\n` +
    formatEffectiveConfig(dialog, provider, messageCount);

  const rows: InlineKeyboardButton[][] = [
    [Markup.button.callback("🤖 Выбрать модель", cb("mdl"))],
    [Markup.button.callback("📝 Системный промпт", cb("prm"))],
    [Markup.button.callback("✏️ Переименовать диалог", cb("ren"))],
  ];
  if (dialog.model || dialog.systemPrompt) {
    rows.push([Markup.button.callback("♻️ Сбросить к настройкам провайдера", cb("rst"))]);
  }

  const webappUrl = process.env.WEBAPP_URL?.trim();
  if (webappUrl) {
    try {
      rows.push([Markup.button.webApp("📱 Открыть в приложении", new URL("/neuro", webappUrl).toString())]);
    } catch {
      log.warn("WEBAPP_URL is not a valid URL — skipping the Mini App button.");
    }
  }
  rows.push([Markup.button.callback("❌ Закрыть", cb("close"))]);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

export async function handleNeuroSettingsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  cleanExpired();
  cancelBatch(dbUser.id);

  const dialogId = await getActiveDialogId(dbUser.id);
  // Opening a panel must not consume one of the user's dialog slots.
  const panel = dialogId ? await buildRootPanel(dbUser.id, dialogId) : null;
  if (!dialogId || !panel) {
    await ctx.reply("У вас пока нет активного диалога. Отправьте сообщение — и настройки станут доступны.");
    return;
  }

  const messageId = await replyMarkdownWithFallback(ctx, panel.text, panel.keyboard);
  if (messageId == null) return;

  settingsStates.set(telegramId, {
    dialogId,
    panelChatId: ctx.chat!.id,
    panelMessageId: messageId,
    filters: { query: "", free: false },
    page: 0,
    vendorPage: 0,
    catalog: null,
    results: [],
    vendors: [],
    awaiting: null,
    timestamp: Date.now(),
  });
}

async function renderRoot(ctx: Context, state: NeuroSettingsState, dbUserId: number): Promise<void> {
  const panel = await buildRootPanel(dbUserId, state.dialogId);
  if (!panel) {
    settingsStates.delete(ctx.from!.id);
    await editPanel(ctx, state, `⚠️ ${DIALOG_GONE_MSG}`, Markup.inlineKeyboard([]));
    return;
  }
  state.awaiting = null;
  await editPanel(ctx, state, panel.text, panel.keyboard);
}

// ─── Model picker ───────────────────────────────────────────────────────────

async function ensureCatalog(state: NeuroSettingsState): Promise<boolean> {
  if (state.catalog) return true;
  try {
    state.catalog = await listOpenRouterModels();
    state.vendors = vendorsOf(state.catalog);
    return true;
  } catch (err) {
    log.error("Failed to load the OpenRouter catalog:", err);
    return false;
  }
}

function catalogErrorPanel(): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } {
  return {
    text: "⚠️ Не удалось загрузить каталог моделей OpenRouter. Модель диалога не изменена.",
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback("🔁 Повторить", cb("mdl"))],
      [Markup.button.callback("✍️ Ввести ID вручную", cb("mid"))],
      [Markup.button.callback(btnBackTo("настройкам"), cb("open"))],
    ]),
  };
}

async function renderPicker(
  ctx: Context,
  state: NeuroSettingsState,
  dbUserId: number
): Promise<void> {
  if (!(await ensureCatalog(state))) {
    const panel = catalogErrorPanel();
    await editPanel(ctx, state, panel.text, panel.keyboard);
    return;
  }

  const dialog = await getDialogById(state.dialogId, dbUserId);
  if (!dialog) {
    await editPanel(ctx, state, `⚠️ ${DIALOG_GONE_MSG}`, Markup.inlineKeyboard([]));
    return;
  }

  state.results = buildPickerResults(state.catalog!, state.filters);
  state.page = clampPage(state.page, state.results.length);
  const { items, startIndex } = pageSlice(state.results, state.page);

  const currentModel = dialog.model;
  const rows: InlineKeyboardButton[][] = items.map((m, i) => [
    Markup.button.callback(formatModelLabel(m, m.id === currentModel), buildSelectData(startIndex + i)),
  ]);

  rows.push([
    Markup.button.callback(
      state.filters.free ? "✅ Только бесплатные" : "🆓 Только бесплатные",
      cb("mfree")
    ),
  ]);
  rows.push([
    Markup.button.callback(`🏷 Вендор: ${state.filters.vendor ?? "все"}`, cb("mven")),
  ]);
  rows.push([
    Markup.button.callback("🔎 Поиск", cb("msrch")),
    Markup.button.callback("🧹 Сбросить фильтры", cb("mclr")),
  ]);

  const pages = pageCount(state.results.length);
  if (pages > 1) {
    const nav: InlineKeyboardButton[] = [];
    if (state.page > 0) nav.push(Markup.button.callback(BTN_PREV, buildPageData(state.page - 1)));
    if (state.page < pages - 1) nav.push(Markup.button.callback(BTN_NEXT, buildPageData(state.page + 1)));
    if (nav.length > 0) rows.push(nav);
  }

  rows.push([Markup.button.callback("⭐ По умолчанию (провайдер)", cb("mdef"))]);
  rows.push([Markup.button.callback("✍️ Ввести ID вручную", cb("mid"))]);
  rows.push([Markup.button.callback(btnBackTo("настройкам"), cb("open"))]);

  const currentInCatalog = currentModel
    ? state.catalog!.find((m) => m.id === currentModel)
    : undefined;
  const currentLine = currentModel
    ? `\nТекущая: \`${currentModel}\`${currentInCatalog ? `\n_${formatModelHint(currentInCatalog)}_` : ""}`
    : "\nТекущая: по умолчанию (модель провайдера)";
  const hint = items.length > 0 ? "" : "\n\nНичего не найдено — измените фильтры.";

  const text =
    "🤖 *Выбор модели*\n" +
    formatFiltersLine(state.filters, state.results.length, state.page) +
    currentLine +
    hint +
    "\n\nЕсли выбранная модель недоступна, бот использует резервную.";

  state.awaiting = null;
  await editPanel(ctx, state, text, Markup.inlineKeyboard(rows));
}

async function renderVendors(ctx: Context, state: NeuroSettingsState): Promise<void> {
  if (!(await ensureCatalog(state))) {
    const panel = catalogErrorPanel();
    await editPanel(ctx, state, panel.text, panel.keyboard);
    return;
  }

  state.vendorPage = clampPage(state.vendorPage, state.vendors.length, VENDOR_PAGE_SIZE);
  const { items, startIndex } = pageSlice(state.vendors, state.vendorPage, VENDOR_PAGE_SIZE);

  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2).map((vendor, j) =>
      Markup.button.callback(
        vendor === state.filters.vendor ? `✅ ${vendor}` : vendor,
        buildVendorData(startIndex + i + j)
      )
    );
    rows.push(pair);
  }

  const pages = Math.max(1, Math.ceil(state.vendors.length / VENDOR_PAGE_SIZE));
  if (pages > 1) {
    const nav: InlineKeyboardButton[] = [];
    if (state.vendorPage > 0) {
      nav.push(Markup.button.callback(BTN_PREV, buildVendorPageData(state.vendorPage - 1)));
    }
    if (state.vendorPage < pages - 1) {
      nav.push(Markup.button.callback(BTN_NEXT, buildVendorPageData(state.vendorPage + 1)));
    }
    if (nav.length > 0) rows.push(nav);
  }

  rows.push([Markup.button.callback("🏷 Все вендоры", buildVendorData(-1))]);
  rows.push([Markup.button.callback(btnBackTo("моделям"), cb("mdl"))]);

  await editPanel(
    ctx,
    state,
    `🏷 *Вендор*\nСтраница ${state.vendorPage + 1}/${pages} · всего ${state.vendors.length}`,
    Markup.inlineKeyboard(rows)
  );
}

// ─── Prompt sub-view ────────────────────────────────────────────────────────

async function renderPrompt(ctx: Context, state: NeuroSettingsState, dbUserId: number): Promise<void> {
  const dialog = await getDialogById(state.dialogId, dbUserId);
  if (!dialog) {
    await editPanel(ctx, state, `⚠️ ${DIALOG_GONE_MSG}`, Markup.inlineKeyboard([]));
    return;
  }

  const current = dialog.systemPrompt
    ? `\n\nТекущий промпт:\n_${truncateText(dialog.systemPrompt, 500)}_`
    : "\n\nСейчас используется базовый промпт.";

  const rows: InlineKeyboardButton[][] = [[Markup.button.callback("✍️ Задать промпт", cb("prmset"))]];
  if (dialog.systemPrompt) {
    rows.push([Markup.button.callback("🧹 Сбросить промпт", cb("prmdel"))]);
  }
  rows.push([Markup.button.callback(btnBackTo("настройкам"), cb("open"))]);

  const text =
    "📝 *Системный промпт (роль ассистента)*\n" +
    "Инструкция применяется ко всем ответам диалога и *добавляется* к базовым правилам, а не заменяет их." +
    current;

  state.awaiting = null;
  await editPanel(ctx, state, text, Markup.inlineKeyboard(rows));
}

// ─── Text-input steps ───────────────────────────────────────────────────────

const AWAITING_PROMPTS: Record<AwaitingKind, string> = {
  search: "🔎 Отправьте подстроку для поиска модели — например `gpt`, `claude`, `qwen`. «-» очистит поиск.",
  prompt:
    `📝 Отправьте системный промпт одним сообщением (до ${SYSTEM_PROMPT_MAX} символов). ` +
    "Он будет ДОБАВЛЕН к базовым правилам ассистента, а не заменит их. «-» вернёт промпт по умолчанию.",
  title: `✏️ Отправьте новое название диалога (до ${DIALOG_TITLE_MAX} символов).`,
  modelId:
    "✍️ Отправьте ID модели OpenRouter, например `anthropic/claude-sonnet-4`. " +
    "ID не проверяется по каталогу — ошибка выяснится при первом запросе.",
};

async function askForInput(
  ctx: Context,
  state: NeuroSettingsState,
  kind: AwaitingKind
): Promise<void> {
  state.awaiting = kind;
  state.timestamp = Date.now();
  await editPanel(
    ctx,
    state,
    AWAITING_PROMPTS[kind],
    Markup.inlineKeyboard([[Markup.button.callback("❌ Отмена", cb("cancel"))]])
  );
}

/** Sends a *new* panel: editing the old one (which is now above the user's reply)
 *  reads as "nothing happened". */
async function sendFreshRoot(ctx: Context, state: NeuroSettingsState, dbUserId: number): Promise<void> {
  const panel = await buildRootPanel(dbUserId, state.dialogId);
  if (!panel) {
    await ctx.reply(`⚠️ ${DIALOG_GONE_MSG}`);
    settingsStates.delete(ctx.from!.id);
    return;
  }
  const id = await replyMarkdownWithFallback(ctx, panel.text, panel.keyboard);
  if (id != null) state.panelMessageId = id;
  state.awaiting = null;
  state.timestamp = Date.now();
}

export async function handleNeuroSettingsText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  cleanExpired();
  const state = settingsStates.get(telegramId);
  // An expired step lets the text fall through to the chat — never swallowed forever.
  if (!state || !state.awaiting) return false;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return false;

  const raw = ctx.message.text;
  state.timestamp = Date.now();

  switch (state.awaiting) {
    case "search": {
      state.filters.query = normalizeSearchQuery(raw);
      state.page = 0;
      state.awaiting = null;
      await sendPickerAsNewPanel(ctx, state, dbUser.id);
      return true;
    }
    case "modelId": {
      const modelId = validateModelId(raw);
      if (!modelId) {
        await ctx.reply(
          `❌ Не похоже на ID модели OpenRouter. Формат: \`вендор/модель\`, до ${MODEL_ID_MAX} символов.`,
          { parse_mode: "Markdown" }
        );
        return true;
      }
      await applyPatch(ctx, state, dbUser.id, { model: modelId }, "model");
      return true;
    }
    case "prompt": {
      const result = validateSystemPrompt(raw);
      if (!result.ok) {
        await ctx.reply(`❌ ${result.error}`);
        return true;
      }
      await applyPatch(ctx, state, dbUser.id, { systemPrompt: result.value }, "systemPrompt");
      return true;
    }
    case "title": {
      const result = validateDialogTitle(raw);
      if (!result.ok) {
        await ctx.reply(`❌ ${result.error}`);
        return true;
      }
      await applyPatch(ctx, state, dbUser.id, { title: result.value }, "title");
      return true;
    }
  }
}

async function sendPickerAsNewPanel(
  ctx: Context,
  state: NeuroSettingsState,
  dbUserId: number
): Promise<void> {
  const id = await replyMarkdownWithFallback(ctx, "🤖 Обновляю список моделей…", Markup.inlineKeyboard([]));
  if (id != null) state.panelMessageId = id;
  await renderPicker(ctx, state, dbUserId);
}

async function applyPatch(
  ctx: Context,
  state: NeuroSettingsState,
  dbUserId: number,
  patch: { title?: string; model?: string | null; systemPrompt?: string | null },
  field: string
): Promise<void> {
  const updated = await updateDialogSettings(state.dialogId, dbUserId, patch);
  if (!updated) {
    await ctx.reply(`⚠️ ${DIALOG_GONE_MSG}`);
    settingsStates.delete(ctx.from!.id);
    return;
  }
  logAction(dbUserId, ctx.from!.id, "chat_dialog_settings_update", { dialogId: state.dialogId, field });
  // The in-flight batch (if any) resolves its config at flush time, so a change
  // applies to messages the user already sent — nothing to cancel here.
  await sendFreshRoot(ctx, state, dbUserId);
}

// ─── Callback router ────────────────────────────────────────────────────────

export async function handleNeuroSettingsCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const action = parseSettingsCallback(data ?? "");
  if (!action) {
    await ctx.answerCbQuery();
    return;
  }

  cleanExpired();
  const state = settingsStates.get(telegramId);
  if (!state) {
    await ctx.answerCbQuery(EXPIRED_MSG, { show_alert: true });
    return;
  }

  const msgId = ctx.callbackQuery?.message?.message_id;
  if (msgId != null && msgId !== state.panelMessageId) {
    await ctx.answerCbQuery(STALE_PANEL_MSG, { show_alert: true });
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery();
    return;
  }

  state.timestamp = Date.now();

  try {
    switch (action.kind) {
      case "open":
      case "cancelInput":
        await ctx.answerCbQuery();
        await renderRoot(ctx, state, dbUser.id);
        break;

      case "close":
        settingsStates.delete(telegramId);
        await ctx.answerCbQuery("Настройки закрыты");
        await editPanel(ctx, state, "⚙️ Настройки закрыты.", Markup.inlineKeyboard([]));
        break;

      case "models":
        await ctx.answerCbQuery();
        await renderPicker(ctx, state, dbUser.id);
        break;

      case "page":
        await ctx.answerCbQuery();
        state.page = action.page;
        await renderPicker(ctx, state, dbUser.id);
        break;

      case "select": {
        const model = state.results[action.index];
        if (!model) {
          await ctx.answerCbQuery("Список устарел, откройте настройки заново", { show_alert: true });
          return;
        }
        const updated = await updateDialogSettings(state.dialogId, dbUser.id, { model: model.id });
        if (!updated) {
          await ctx.answerCbQuery(DIALOG_GONE_MSG, { show_alert: true });
          settingsStates.delete(telegramId);
          return;
        }
        logAction(dbUser.id, telegramId, "chat_dialog_settings_update", {
          dialogId: state.dialogId,
          field: "model",
        });
        await ctx.answerCbQuery(`Модель: ${truncateText(model.id, 40)}`);
        await renderRoot(ctx, state, dbUser.id);
        break;
      }

      case "toggleFree":
        state.filters.free = !state.filters.free;
        state.page = 0;
        await ctx.answerCbQuery();
        await renderPicker(ctx, state, dbUser.id);
        break;

      case "vendors":
        await ctx.answerCbQuery();
        await renderVendors(ctx, state);
        break;

      case "vendorPage":
        state.vendorPage = action.page;
        await ctx.answerCbQuery();
        await renderVendors(ctx, state);
        break;

      case "vendor": {
        if (action.index < 0) {
          state.filters.vendor = undefined;
        } else {
          const vendor = state.vendors[action.index];
          if (!vendor) {
            await ctx.answerCbQuery("Список устарел, откройте настройки заново", { show_alert: true });
            return;
          }
          state.filters.vendor = vendor;
        }
        state.page = 0;
        await ctx.answerCbQuery();
        await renderPicker(ctx, state, dbUser.id);
        break;
      }

      case "clearFilters":
        state.filters = { query: "", free: false };
        state.page = 0;
        await ctx.answerCbQuery("Фильтры сброшены");
        await renderPicker(ctx, state, dbUser.id);
        break;

      case "useDefault":
        await ctx.answerCbQuery("Модель провайдера");
        await applyPatchFromCallback(ctx, state, dbUser.id, { model: null }, "model");
        break;

      case "search":
        await ctx.answerCbQuery();
        await askForInput(ctx, state, "search");
        break;

      case "manualId":
        await ctx.answerCbQuery();
        await askForInput(ctx, state, "modelId");
        break;

      case "prompt":
        await ctx.answerCbQuery();
        await renderPrompt(ctx, state, dbUser.id);
        break;

      case "promptSet":
        await ctx.answerCbQuery();
        await askForInput(ctx, state, "prompt");
        break;

      case "promptClear":
        await ctx.answerCbQuery("Промпт сброшен");
        await applyPatchFromCallback(ctx, state, dbUser.id, { systemPrompt: null }, "systemPrompt");
        break;

      case "rename":
        await ctx.answerCbQuery();
        await askForInput(ctx, state, "title");
        break;

      case "reset":
        await ctx.answerCbQuery();
        await editPanel(
          ctx,
          state,
          "♻️ Сбросить модель *и* системный промпт диалога к настройкам провайдера?\nСвой промпт будет удалён.",
          Markup.inlineKeyboard([
            [Markup.button.callback("✅ Да, сбросить", cb("rstyes"))],
            [Markup.button.callback(btnBackTo("настройкам"), cb("open"))],
          ])
        );
        break;

      case "resetConfirm":
        await ctx.answerCbQuery("Сброшено");
        await applyPatchFromCallback(
          ctx, state, dbUser.id, { model: null, systemPrompt: null }, "reset"
        );
        break;
    }
  } catch (err) {
    log.error("Neuro settings callback error:", err);
    try {
      await ctx.answerCbQuery("Ошибка. Попробуйте ещё раз.");
    } catch {
      // Callback may already be answered.
    }
  }
}

async function applyPatchFromCallback(
  ctx: Context,
  state: NeuroSettingsState,
  dbUserId: number,
  patch: { title?: string; model?: string | null; systemPrompt?: string | null },
  field: string
): Promise<void> {
  const updated = await updateDialogSettings(state.dialogId, dbUserId, patch);
  if (!updated) {
    settingsStates.delete(ctx.from!.id);
    await editPanel(ctx, state, `⚠️ ${DIALOG_GONE_MSG}`, Markup.inlineKeyboard([]));
    return;
  }
  logAction(dbUserId, ctx.from!.id, "chat_dialog_settings_update", { dialogId: state.dialogId, field });
  await renderRoot(ctx, state, dbUserId);
}
