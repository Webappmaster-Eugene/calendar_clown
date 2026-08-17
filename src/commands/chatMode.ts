import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  saveMessage,
  getRecentMessages,
  clearDialogHistory,
  getOrCreateActiveDialog,
  getDialogsByUser,
  createDialog,
  deleteDialog,
  getDialogById,
  setActiveDialogId,
  getActiveDialogId,
  updateDialogTitle,
  getChatProvider,
  setChatProvider,
  isDialogAtMessageLimit,
} from "../chat/repository.js";
import { chatCompletion, generateDialogTitle } from "../chat/client.js";
import {
  resolveDialogAiConfig,
  formatEffectiveConfig,
  formatProviderDescription,
  CHAT_LIMIT_REACHED_MSG,
} from "../chat/config.js";
import { augmentUserMessage, isWebSearchConfigured } from "../chat/augment.js";
import { resolveWebSearchStrategy, type WebSearchStrategy } from "../chat/webSearchStrategy.js";
import { splitMessage } from "../utils/telegram.js";
import { setModeMenuCommands, getModeButtons } from "./expenseMode.js";
import { NEURO_VISION_MODEL, CHAT_MESSAGE_LIMIT, CHAT_MAX_DIALOGS } from "../constants.js";
import type { ChatProvider } from "../shared/types.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";
import type { ContentPart, MessageContent } from "../utils/openRouterClient.js";
import { addMessage, cancelBatch, hasPendingBatch, flushBatchSync } from "../chat/messageBatcher.js";
import { checkCostlyRateLimit, COSTLY_LIMIT_MESSAGE } from "../middleware/rateLimit.js";
import { processNeuroRequest } from "../chat/neuroProcessor.js";
import { handleNeuroSettingsText, cancelNeuroSettings, NEURO_SETTINGS_BUTTON } from "./chatSettings.js";

const log = createLogger("neuro");

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
]);

const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".md", ".json", ".xml", ".html", ".log", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".env"]);

const IMAGE_MIME_PREFIXES = ["image/"];

const GEMINI_DOC_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

function getNeuroKeyboard(isAdmin: boolean, provider: ChatProvider = "free") {
  const providers: Array<{ key: ChatProvider; emoji: string; label: string }> = [
    { key: "free", emoji: "🆓", label: "Free" },
    { key: "paid", emoji: "💎", label: "Paid" },
    { key: "uncensored", emoji: "🔥", label: "Без цензуры" },
  ];
  const providerButtons = providers.map(({ key, emoji, label }) =>
    key === provider ? `✅ ${label}` : `${emoji} ${label}`
  );
  return Markup.keyboard([
    ["💬 Диалоги", "➕ Новый диалог"],
    [NEURO_SETTINGS_BUTTON, "🗑 Очистить историю"],
    providerButtons,
    ...getModeButtons(isAdmin),
  ]).resize();
}

function autoNameDialog(dialogId: number, firstMessage: string, model?: string): void {
  generateDialogTitle(firstMessage, model)
    .then((title) => {
      if (title && title !== "Новый диалог") {
        return updateDialogTitle(dialogId, title);
      }
    })
    .catch((err) => {
      log.error("Failed to auto-name dialog:", err);
    });
}

/** Runs the shared link/search augmentation, reporting progress by editing the
 *  status message when the caller has one (voice); attachments only show "typing". */
async function augmentForBot(
  text: string,
  historyMessages: Array<{ role: string; content: string }>,
  ctx: Context,
  searchStrategy: WebSearchStrategy,
  statusMsgId?: number
): Promise<string> {
  const result = await augmentUserMessage({
    text,
    history: historyMessages,
    searchStrategy,
    onStatus: statusMsgId
      ? async (status) => {
          try {
            await ctx.telegram.editMessageText(ctx.chat!.id, statusMsgId, undefined, status.label);
          } catch {
            // Status edit may fail if the message was deleted.
          }
        }
      : undefined,
  });
  return result.augmentedText;
}

function botSearchStrategy(model: string): WebSearchStrategy {
  return resolveWebSearchStrategy(model, { tavilyConfigured: isWebSearchConfigured() });
}

/** Vision models are forced for images/PDFs regardless of the dialog's model (we
 *  can't tell from the catalog which models accept images), so say so explicitly
 *  instead of silently answering with a different model than the panel shows. */
function visionModelNote(dialogModel: string | null): string {
  if (!dialogModel || dialogModel === NEURO_VISION_MODEL) return "";
  return `\n\n_🖼 Файл обработан vision-моделью ${NEURO_VISION_MODEL} — модель диалога применяется к тексту._`;
}

async function replyLimitReached(ctx: Context): Promise<void> {
  await ctx.reply(`⚠️ ${CHAT_LIMIT_REACHED_MSG}`);
}

export async function handleNeuroCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ Нейро-режим временно недоступен (нет подключения к базе данных).");
    return;
  }

  await setUserMode(telegramId, "neuro");
  await setModeMenuCommands(ctx, "neuro");
  cancelNeuroSettings(telegramId);

  const isAdmin = isBootstrapAdmin(telegramId);
  const dbUser = await getUserByTelegramId(telegramId);
  const provider = dbUser ? await getChatProvider(dbUser.id) : "free";
  const dialogId = dbUser ? await getActiveDialogId(dbUser.id) : null;
  const dialog = dbUser && dialogId ? await getDialogById(dialogId, dbUser.id) : null;

  const { model: effectiveModel } = resolveDialogAiConfig(
    dialog ?? { model: null, systemPrompt: null },
    provider
  );
  const searchLine = {
    native: "🔍 Модель сама ищет в интернете, когда это нужно (встроенный поиск).\n" +
      "🔗 Ссылки в сообщениях читаются и анализируются.\n",
    context: "🔍 Бот автоматически ищет информацию в интернете при необходимости.\n" +
      "🔗 Ссылки в сообщениях читаются и анализируются.\n",
    off: "⚠️ Веб-поиск отключён — отвечаю без интернета.\n" +
      "🔗 Ссылки в сообщениях всё равно читаются и анализируются.\n",
  }[botSearchStrategy(effectiveModel)];

  const text =
    "🧠 *Режим Нейро активирован*\n\n" +
    "Отправьте текст, голосовое, фото или документ — я отвечу с помощью AI.\n" +
    "Поддерживаемые форматы: изображения, PDF, DOCX, XLSX, текстовые файлы.\n\n" +
    `💬 Можно вести до ${CHAT_MAX_DIALOGS} параллельных диалогов.\n` +
    `Контекст — вся история диалога (до ${CHAT_MESSAGE_LIMIT} сообщений, дальше нужен новый).\n\n` +
    searchLine +
    "📨 Можно отправлять несколько сообщений подряд — они будут обработаны как один запрос.\n\n" +
    formatEffectiveConfig(dialog, provider) + "\n\n" +
    `⚙️ Модель, промпт и название — кнопка «${NEURO_SETTINGS_BUTTON}».`;

  const keyboard = getNeuroKeyboard(isAdmin, provider);
  try {
    await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
  } catch {
    // Model ids contain "_", so Markdown parsing can fail — fall back to plain text.
    await ctx.reply(text.replace(/[*_`]/g, ""), keyboard);
  }
}

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

  // A settings step ("send me the new prompt") must consume the text instead of
  // letting it become a chat message.
  if (await handleNeuroSettingsText(ctx)) return true;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return false;

  try {
    const dialog = await getOrCreateActiveDialog(dbUser.id);
    if (await isDialogAtMessageLimit(dialog.id)) {
      await replyLimitReached(ctx);
      return true;
    }
    const provider = await getChatProvider(dbUser.id);
    logAction(dbUser.id, telegramId, "chat_message_send", { dialogId: dialog.id, provider });
    addMessage(dbUser.id, telegramId, dialog.id, userText, ctx, processNeuroRequest);
  } catch (err) {
    log.error("Neuro text batch error:", err);
    await ctx.reply("❌ Ошибка при обработке запроса. Попробуйте позже.");
  }

  return true;
}

export async function handleNeuroClearButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  cancelBatch(dbUser.id);

  const dialog = await getOrCreateActiveDialog(dbUser.id);
  const deleted = await clearDialogHistory(dialog.id, dbUser.id);
  logAction(dbUser.id, telegramId, "chat_clear_context", { dialogId: dialog.id, deletedCount: deleted });
  await ctx.reply(`🗑 История диалога «${dialog.title}» очищена (удалено ${deleted} сообщений).`);
}

export async function handleNeuroDialogsButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  cancelBatch(dbUser.id);

  const dialogs = await getDialogsByUser(dbUser.id);
  const activeId = await getActiveDialogId(dbUser.id);

  if (dialogs.length === 0) {
    await ctx.reply("У вас пока нет диалогов. Отправьте сообщение, чтобы начать первый.");
    return;
  }

  const buttons = dialogs.map((d) => {
    const marker = d.id === activeId ? " ✅" : "";
    return [Markup.button.callback(
      `${d.title}${marker}`,
      `neuro_dlg:${d.id}`
    )];
  });

  buttons.push([Markup.button.callback("🗑 Удалить диалог…", "neuro_dlg_del_mode")]);

  await ctx.reply("💬 *Ваши диалоги:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleNeuroNewDialogButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  cancelBatch(dbUser.id);

  try {
    const dialog = await createDialog(dbUser.id);
    await setActiveDialogId(dbUser.id, dialog.id);
    logAction(dbUser.id, telegramId, "chat_dialog_create", { dialogId: dialog.id });
    await ctx.reply("✅ Создан новый диалог. Отправьте сообщение, чтобы начать.");
  } catch (err) {
    if (err instanceof Error && err.message.includes("лимит")) {
      await ctx.reply(`⚠️ ${err.message}`);
    } else {
      log.error("Failed to create dialog:", err);
      await ctx.reply("❌ Ошибка при создании диалога.");
    }
  }
}

export async function handleNeuroDialogSwitch(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const dialogId = parseInt(data.replace("neuro_dlg:", ""), 10);
  if (isNaN(dialogId)) return;

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден");
    return;
  }

  const dialog = await getDialogById(dialogId, dbUser.id);
  if (!dialog) {
    await ctx.answerCbQuery("Диалог не найден");
    return;
  }

  cancelBatch(dbUser.id);

  await setActiveDialogId(dbUser.id, dialog.id);
  logAction(dbUser.id, telegramId, "chat_dialog_switch", { dialogId: dialog.id });
  await ctx.answerCbQuery(`Переключено на «${dialog.title}»`);

  const dialogs = await getDialogsByUser(dbUser.id);
  const buttons = dialogs.map((d) => {
    const marker = d.id === dialog.id ? " ✅" : "";
    return [Markup.button.callback(
      `${d.title}${marker}`,
      `neuro_dlg:${d.id}`
    )];
  });
  buttons.push([Markup.button.callback("🗑 Удалить диалог…", "neuro_dlg_del_mode")]);

  try {
    await ctx.editMessageText("💬 *Ваши диалоги:*", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    /* ignore */
  }
}

export async function handleNeuroDialogDeleteMode(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден");
    return;
  }

  await ctx.answerCbQuery();

  const dialogs = await getDialogsByUser(dbUser.id);

  if (dialogs.length === 0) {
    try {
      await ctx.editMessageText("Нет диалогов для удаления.");
    } catch {
      await ctx.reply("Нет диалогов для удаления.");
    }
    return;
  }

  const buttons = dialogs.map((d) => [
    Markup.button.callback(`🗑 ${d.title}`, `neuro_dlg_del:${d.id}`),
  ]);

  try {
    await ctx.editMessageText("Выберите диалог для удаления:", {
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await ctx.reply("Выберите диалог для удаления:", {
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

export async function handleNeuroDialogDelete(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const dialogId = parseInt(data.replace("neuro_dlg_del:", ""), 10);
  if (isNaN(dialogId)) return;

  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.answerCbQuery("Пользователь не найден");
    return;
  }

  const dialog = await getDialogById(dialogId, dbUser.id);
  if (!dialog) {
    await ctx.answerCbQuery("Диалог не найден");
    return;
  }

  await deleteDialog(dialogId, dbUser.id);
  logAction(dbUser.id, telegramId, "chat_dialog_delete", { dialogId });
  await ctx.answerCbQuery(`Диалог «${dialog.title}» удалён`);

  const remaining = await getDialogsByUser(dbUser.id);

  if (remaining.length === 0) {
    try {
      await ctx.editMessageText("Все диалоги удалены. Отправьте сообщение, чтобы начать новый.");
    } catch {
      await ctx.reply("Все диалоги удалены. Отправьте сообщение, чтобы начать новый.");
    }
    return;
  }

  const buttons = remaining.map((d) => [
    Markup.button.callback(`🗑 ${d.title}`, `neuro_dlg_del:${d.id}`),
  ]);

  try {
    await ctx.editMessageText("Выберите диалог для удаления:", {
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    // ignore
  }
}

export async function handleNeuroVoice(
  ctx: Context,
  transcript: string,
  statusMsgId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined,
      "⚠️ Нейро-режим временно недоступен."
    );
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  try {
    let prependText = "";
    let pendingDialogId: number | undefined;
    if (hasPendingBatch(dbUser.id)) {
      const pending = flushBatchSync(dbUser.id);
      if (pending) {
        prependText = pending.combinedText + "\n\n";
        pendingDialogId = pending.dialogId;
      }
    }

    const fullText = prependText + transcript;

    const dialog = (pendingDialogId ? await getDialogById(pendingDialogId, dbUser.id) : null)
      ?? await getOrCreateActiveDialog(dbUser.id);

    if (await isDialogAtMessageLimit(dialog.id)) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        `⚠️ ${CHAT_LIMIT_REACHED_MSG}`
      );
      return;
    }

    const provider = await getChatProvider(dbUser.id);
    const { model, persona, uncensored } = resolveDialogAiConfig(dialog, provider);
    const history = await getRecentMessages(dialog.id);
    const historyMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const searchStrategy = botSearchStrategy(model);
    const augmentedText = await augmentForBot(fullText, historyMessages, ctx, searchStrategy, statusMsgId);

    const messages: Array<{ role: string; content: string }> = [
      ...historyMessages,
      { role: "user", content: augmentedText },
    ];

    const result = await chatCompletion(messages, {
      model,
      persona,
      uncensored,
      webSearch: searchStrategy,
    });

    const userEntry = prependText
      ? `${prependText}[Голос] ${transcript}`
      : `[Голос] ${transcript}`;
    await saveMessage(dbUser.id, dialog.id, "user", userEntry);
    await saveMessage(dbUser.id, dialog.id, "assistant", result.content, model, result.tokensUsed ?? undefined);

    if (dialog.title === "Новый диалог") {
      autoNameDialog(dialog.id, transcript, model);
    }

    const fullReply = `🎤 _${transcript}_\n\n${result.content}`;
    const chunks = splitMessage(fullReply);

    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        chunks[0],
        { parse_mode: "Markdown" }
      );
    } catch {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, statusMsgId, undefined,
        chunks[0]
      );
    }

    for (let i = 1; i < chunks.length; i++) {
      try {
        await ctx.replyWithMarkdown(chunks[i]);
      } catch {
        await ctx.reply(chunks[i]);
      }
    }
  } catch (err) {
    log.error("Neuro voice error:", err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id, statusMsgId, undefined,
      "❌ Ошибка при обработке голосового. Попробуйте позже."
    );
  }
}

export async function handleNeuroPhoto(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ Нейро-режим временно недоступен.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  if (!ctx.message || !("photo" in ctx.message)) return;

  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  // A vision call plus a multi-MB download per photo — capped like voice.
  if (!checkCostlyRateLimit(telegramId)) {
    await ctx.reply(COSTLY_LIMIT_MESSAGE);
    return;
  }

  let prependText = "";
  let pendingDialogId: number | undefined;
  if (hasPendingBatch(dbUser.id)) {
    const pending = flushBatchSync(dbUser.id);
    if (pending) {
      prependText = pending.combinedText + "\n\n";
      pendingDialogId = pending.dialogId;
    }
  }

  const caption = ctx.message.caption || "Опиши что на изображении";
  const fullCaption = prependText ? prependText + caption : caption;

  try {
    // Resolve the dialog before downloading: no point pulling megabytes for a
    // dialog that can no longer be written to.
    const dialog = (pendingDialogId ? await getDialogById(pendingDialogId, dbUser.id) : null)
      ?? await getOrCreateActiveDialog(dbUser.id);
    if (await isDialogAtMessageLimit(dialog.id)) {
      await replyLimitReached(ctx);
      return;
    }

    await ctx.sendChatAction("typing");

    const photo = photos[photos.length - 1];
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    const photoProvider = await getChatProvider(dbUser.id);
    const { model: photoModel, persona, uncensored } = resolveDialogAiConfig(dialog, photoProvider);
    const history = await getRecentMessages(dialog.id);
    const historyMessages: Array<{ role: string; content: MessageContent }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const historyForSearch = history.map((m) => ({ role: m.role, content: m.content }));
    // Vision requests go to NEURO_VISION_MODEL, so the search strategy follows it.
    const searchStrategy = botSearchStrategy(NEURO_VISION_MODEL);
    const augmentedText = await augmentForBot(fullCaption, historyForSearch, ctx, searchStrategy);

    const userContent: ContentPart[] = [
      { type: "image_url", image_url: { url: dataUrl } },
      { type: "text", text: augmentedText },
    ];

    const messages: Array<{ role: string; content: MessageContent }> = [
      ...historyMessages,
      { role: "user", content: userContent },
    ];

    const result = await chatCompletion(messages, {
      model: NEURO_VISION_MODEL,
      persona,
      uncensored,
      webSearch: searchStrategy,
    });

    const userEntry = prependText
      ? `${prependText}[Фото] ${caption}`
      : `[Фото] ${caption}`;
    await saveMessage(dbUser.id, dialog.id, "user", userEntry);
    await saveMessage(dbUser.id, dialog.id, "assistant", result.content, NEURO_VISION_MODEL, result.tokensUsed ?? undefined);

    // Auto-name uses the user's chat model, not the vision model.
    if (dialog.title === "Новый диалог") {
      autoNameDialog(dialog.id, caption, photoModel);
    }

    const chunks = splitMessage(result.content + visionModelNote(dialog.model));
    for (const chunk of chunks) {
      try {
        await ctx.replyWithMarkdown(chunk);
      } catch {
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    log.error("Neuro photo error:", err);
    await ctx.reply("❌ Ошибка при обработке изображения. Попробуйте позже.");
  }
}

export async function handleNeuroDocument(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ Нейро-режим временно недоступен.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  if (!ctx.message || !("document" in ctx.message)) return;

  const doc = ctx.message.document;
  if (!doc) return;

  if (!checkCostlyRateLimit(telegramId)) {
    await ctx.reply(COSTLY_LIMIT_MESSAGE);
    return;
  }

  let prependText = "";
  let pendingDialogId: number | undefined;
  if (hasPendingBatch(dbUser.id)) {
    const pending = flushBatchSync(dbUser.id);
    if (pending) {
      prependText = pending.combinedText + "\n\n";
      pendingDialogId = pending.dialogId;
    }
  }

  const caption = ctx.message.caption || "Проанализируй содержимое документа";
  const fullCaption = prependText ? prependText + caption : caption;
  const fileName = doc.file_name || "document";
  const mimeType = doc.mime_type || "";
  const fileSize = doc.file_size || 0;

  if (fileSize > MAX_FILE_SIZE) {
    await ctx.reply(`❌ Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(1)} МБ). Максимум — 15 МБ.`);
    return;
  }

  try {
    // Resolve the dialog before downloading: no point pulling up to 15 MB for a
    // dialog that can no longer be written to.
    const dialog = (pendingDialogId ? await getDialogById(pendingDialogId, dbUser.id) : null)
      ?? await getOrCreateActiveDialog(dbUser.id);
    if (await isDialogAtMessageLimit(dialog.id)) {
      await replyLimitReached(ctx);
      return;
    }

    await ctx.sendChatAction("typing");

    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Failed to download document: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";

    const isImage = IMAGE_MIME_PREFIXES.some((p) => mimeType.startsWith(p));
    const isGeminiDoc = GEMINI_DOC_MIME_TYPES.has(mimeType);
    const isText = TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(ext);

    const docProviderPref = await getChatProvider(dbUser.id);
    const { model: docTitleModel, persona, uncensored } = resolveDialogAiConfig(dialog, docProviderPref);
    const history = await getRecentMessages(dialog.id);
    const historyMessages: Array<{ role: string; content: MessageContent }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const historyForSearch = history.map((m) => ({ role: m.role, content: m.content }));
    // Images and PDFs are answered by NEURO_VISION_MODEL, plain text by the dialog model.
    const searchStrategy = botSearchStrategy(isImage || isGeminiDoc ? NEURO_VISION_MODEL : docTitleModel);
    const augmentedText = await augmentForBot(fullCaption, historyForSearch, ctx, searchStrategy);
    const promptOpts = { persona, uncensored, webSearch: searchStrategy };

    let result;
    let modelUsed: string;

    if (isImage) {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const userContent: ContentPart[] = [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: augmentedText },
      ];

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userContent },
      ];

      result = await chatCompletion(messages, { model: NEURO_VISION_MODEL, ...promptOpts });
      modelUsed = NEURO_VISION_MODEL;
    } else if (isGeminiDoc) {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const userContent: ContentPart[] = [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: augmentedText },
      ];

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userContent },
      ];

      result = await chatCompletion(messages, { model: NEURO_VISION_MODEL, ...promptOpts });
      modelUsed = NEURO_VISION_MODEL;
    } else if (isText) {
      const textContent = buffer.toString("utf-8");
      const truncated = textContent.length > 50000
        ? textContent.slice(0, 50000) + "\n\n[...файл обрезан, показаны первые 50000 символов]"
        : textContent;

      const userMessage = `Файл: ${fileName}\n\n\`\`\`\n${truncated}\n\`\`\`\n\n${augmentedText}`;

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userMessage },
      ];

      result = await chatCompletion(messages, { model: docTitleModel, ...promptOpts });
      modelUsed = docTitleModel;
    } else {
      await ctx.reply(
        `❌ Формат файла не поддерживается: ${mimeType || ext || "неизвестный"}\n\n` +
        "Поддерживаемые форматы: изображения, PDF, DOCX, XLSX, текстовые файлы (.txt, .csv, .json, .md, .xml, .html)."
      );
      return;
    }

    const userEntry = prependText
      ? `${prependText}[Документ: ${fileName}] ${caption}`
      : `[Документ: ${fileName}] ${caption}`;
    await saveMessage(dbUser.id, dialog.id, "user", userEntry);
    await saveMessage(dbUser.id, dialog.id, "assistant", result.content, modelUsed, result.tokensUsed ?? undefined);

    // Auto-name uses the user's chat model, not the vision model.
    if (dialog.title === "Новый диалог") {
      autoNameDialog(dialog.id, `${fileName}: ${caption}`, docTitleModel);
    }

    const note = modelUsed === NEURO_VISION_MODEL ? visionModelNote(dialog.model) : "";
    const chunks = splitMessage(result.content + note);
    for (const chunk of chunks) {
      try {
        await ctx.replyWithMarkdown(chunk);
      } catch {
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    log.error("Neuro document error:", err);
    await ctx.reply("❌ Ошибка при обработке документа. Попробуйте позже.");
  }
}

function parseProviderFromButton(text: string): ChatProvider | null {
  if (text.includes("Free")) return "free";
  if (text.includes("Paid")) return "paid";
  if (text.includes("Без цензуры")) return "uncensored";
  return null;
}

export async function handleProviderSelect(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const buttonText = ctx.message && "text" in ctx.message ? ctx.message.text : "";
  const target = parseProviderFromButton(buttonText);
  if (!target) return;

  const current = await getChatProvider(dbUser.id);
  const isAdmin = isBootstrapAdmin(telegramId);

  if (target === current) {
    await ctx.reply(
      "Эта модель уже активна.",
      getNeuroKeyboard(isAdmin, current)
    );
    return;
  }

  await setChatProvider(dbUser.id, target);
  logAction(dbUser.id, telegramId, "chat_provider_select", { from: current, to: target });

  // A dialog with its own model ignores the provider toggle, so say so explicitly.
  const dialogId = await getActiveDialogId(dbUser.id);
  const dialog = dialogId ? await getDialogById(dialogId, dbUser.id) : null;
  const overrideNote = dialog?.model
    ? `\n\n⚠️ У активного диалога задана своя модель (\`${dialog.model}\`) — переключение провайдера на него не влияет. ` +
      `Сбросьте её в «${NEURO_SETTINGS_BUTTON}».`
    : "";

  const text = `Модель переключена: ${formatProviderDescription(target)}${overrideNote}`;
  const keyboard = getNeuroKeyboard(isAdmin, target);
  try {
    await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
  } catch {
    await ctx.reply(text.replace(/[*_`]/g, ""), keyboard);
  }
}
