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
} from "../chat/repository.js";
import { chatCompletion, generateDialogTitle } from "../chat/client.js";
import { splitMessage } from "../utils/telegram.js";
import { setModeMenuCommands, getModeButtons } from "./expenseMode.js";
import { DEEPSEEK_MODEL, DEEPSEEK_FREE_MODEL, NEURO_VISION_MODEL } from "../constants.js";
import type { ChatProvider } from "../shared/types.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import type { ContentPart, MessageContent } from "../utils/openRouterClient.js";
import { addMessage, cancelBatch, hasPendingBatch, flushBatchSync } from "../chat/messageBatcher.js";
import { processNeuroRequest } from "../chat/neuroProcessor.js";
import { extractUrls, fetchLinksContent, formatLinksForContext } from "../chat/linkAnalyzer.js";
import { classifySearchNeed, executeWebSearch, formatSearchResultsForContext } from "../chat/webSearch.js";

const log = createLogger("neuro");

/** Max file size for document processing (15 MB). */
const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** Max total context from search + links. */
const MAX_AUGMENTED_CONTEXT_LENGTH = 15_000;

/** MIME types that can be sent as text to DeepSeek. */
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
]);

/** File extensions treated as text even without explicit MIME. */
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".md", ".json", ".xml", ".html", ".log", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".env"]);

/** MIME types natively supported by Gemini vision (as base64 image). */
const IMAGE_MIME_PREFIXES = ["image/"];

/** Document MIME types supported by Gemini natively (PDF, DOCX, XLSX). */
const GEMINI_DOC_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

function getNeuroKeyboard(isAdmin: boolean, provider: ChatProvider = "free") {
  const providerBtn = provider === "free" ? "🆓 Free" : "💎 Paid";
  return Markup.keyboard([
    ["💬 Диалоги", "➕ Новый диалог"],
    ["🗑 Очистить историю", providerBtn],
    ...getModeButtons(isAdmin),
  ]).resize();
}

/** Resolve model name from chat provider. */
function resolveModel(provider: ChatProvider): string {
  return provider === "free" ? DEEPSEEK_FREE_MODEL : DEEPSEEK_MODEL;
}

/** Fire-and-forget: auto-generate dialog title after first message. */
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

/** Build augmented text with links + search context. Returns { augmented, linksContext, searchContext }. */
async function augmentWithLinksAndSearch(
  text: string,
  historyMessages: Array<{ role: string; content: string }>,
  ctx: Context,
  statusMsgId?: number
): Promise<string> {
  const urls = extractUrls(text);

  const [linksResult, searchClassification] = await Promise.all([
    urls.length > 0 ? fetchLinksContent(urls) : Promise.resolve([]),
    classifySearchNeed(text, historyMessages),
  ]);

  let searchResults: Awaited<ReturnType<typeof executeWebSearch>> | null = null;
  if (searchClassification.needsSearch && searchClassification.queries.length > 0) {
    if (statusMsgId) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat!.id, statusMsgId, undefined,
          "🔍 Ищу информацию..."
        );
      } catch { /* ignore */ }
    }
    searchResults = await executeWebSearch(searchClassification.queries);
  }

  let linksContext = formatLinksForContext(linksResult);
  let searchContext = searchResults
    ? formatSearchResultsForContext(searchResults.results)
    : "";

  // Truncate if total context is too large
  const totalContextLen = linksContext.length + searchContext.length;
  if (totalContextLen > MAX_AUGMENTED_CONTEXT_LENGTH) {
    const halfLimit = Math.floor(MAX_AUGMENTED_CONTEXT_LENGTH / 2);
    if (linksContext.length > halfLimit) {
      linksContext = linksContext.slice(0, halfLimit) + "\n[...содержимое ссылок обрезано]";
    }
    if (searchContext.length > halfLimit) {
      searchContext = searchContext.slice(0, halfLimit) + "\n[...результаты поиска обрезаны]";
    }
  }

  const parts = [text];
  if (linksContext) parts.push(linksContext);
  if (searchContext) parts.push(searchContext);
  return parts.join("\n\n");
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
  const dbUser = await getUserByTelegramId(telegramId);
  const provider = dbUser ? await getChatProvider(dbUser.id) : "free";
  const providerLabel = provider === "free" ? "🆓 Free (бесплатно)" : "💎 Paid";

  await ctx.reply(
    "🧠 *Режим Нейро активирован*\n\n" +
    "Отправьте текст, голосовое, фото или документ — я отвечу с помощью AI.\n" +
    "Поддерживаемые форматы: изображения, PDF, DOCX, XLSX, текстовые файлы.\n\n" +
    "💬 Можно вести до 10 параллельных диалогов.\n" +
    "Контекст — последние 20 сообщений активного диалога.\n\n" +
    "🔍 Бот автоматически ищет информацию в интернете при необходимости.\n" +
    "🔗 Ссылки в сообщениях анализируются автоматически.\n" +
    "📨 Можно отправлять несколько сообщений подряд — они будут обработаны как один запрос.\n\n" +
    `🤖 Модель: ${providerLabel}`,
    { parse_mode: "Markdown", ...getNeuroKeyboard(isAdmin, provider) }
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
    const dialog = await getOrCreateActiveDialog(dbUser.id);
    const provider = await getChatProvider(dbUser.id);
    const model = resolveModel(provider);
    addMessage(dbUser.id, telegramId, dialog.id, userText, ctx, processNeuroRequest, model);
  } catch (err) {
    log.error("Neuro text batch error:", err);
    await ctx.reply("❌ Ошибка при обработке запроса. Попробуйте позже.");
  }

  return true;
}

/** Handle "🗑 Очистить историю" button — clears only the active dialog. */
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
  await ctx.reply(`🗑 История диалога «${dialog.title}» очищена (удалено ${deleted} сообщений).`);
}

/** Handle "💬 Диалоги" button — show list of dialogs with inline buttons. */
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

/** Handle "➕ Новый диалог" button. */
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

/** Inline callback: switch to a dialog. */
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
  await ctx.answerCbQuery(`Переключено на «${dialog.title}»`);

  // Update the message to reflect the new active dialog
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
    // Message might not have changed
  }
}

/** Inline callback: show delete mode (list dialogs with delete buttons). */
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

/** Inline callback: delete a specific dialog. */
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
  await ctx.answerCbQuery(`Диалог «${dialog.title}» удалён`);

  // Refresh the delete list
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

/** Handle voice messages in neuro mode. Called after transcription. */
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
    // Flush pending text batch if any
    let prependText = "";
    if (hasPendingBatch(dbUser.id)) {
      const pending = flushBatchSync(dbUser.id);
      if (pending) prependText = pending.combinedText + "\n\n";
    }

    const fullText = prependText + transcript;

    const dialog = await getOrCreateActiveDialog(dbUser.id);
    const provider = await getChatProvider(dbUser.id);
    const model = resolveModel(provider);
    const history = await getRecentMessages(dialog.id, 20);
    const historyMessages = history.map((m) => ({ role: m.role, content: m.content }));

    // Augment with links + search
    const augmentedMessage = await augmentWithLinksAndSearch(
      fullText, historyMessages, ctx, statusMsgId
    );

    const messages: Array<{ role: string; content: string }> = [
      ...historyMessages,
      { role: "user", content: augmentedMessage },
    ];

    const result = await chatCompletion(messages, model);

    // Save original text only (no search/links context)
    const userEntry = prependText
      ? `${prependText}[Голос] ${transcript}`
      : `[Голос] ${transcript}`;
    await saveMessage(dbUser.id, dialog.id, "user", userEntry);
    await saveMessage(dbUser.id, dialog.id, "assistant", result.content, model, result.tokensUsed ?? undefined);

    // Auto-name dialog on first message
    if (dialog.title === "Новый диалог") {
      autoNameDialog(dialog.id, transcript, model);
    }

    const fullReply = `🎤 _${transcript}_\n\n${result.content}`;
    const chunks = splitMessage(fullReply);

    // Edit status message with first chunk
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

    // Send remaining chunks as separate messages
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

/** Handle photo messages in neuro mode. */
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

  // Flush pending text batch if any
  let prependText = "";
  if (hasPendingBatch(dbUser.id)) {
    const pending = flushBatchSync(dbUser.id);
    if (pending) prependText = pending.combinedText + "\n\n";
  }

  const caption = ctx.message.caption || "Опиши что на изображении";
  const fullCaption = prependText ? prependText + caption : caption;

  try {
    await ctx.sendChatAction("typing");

    // Get largest photo (last in array)
    const photo = photos[photos.length - 1];
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    // Build multimodal message
    const dialog = await getOrCreateActiveDialog(dbUser.id);
    const photoProvider = await getChatProvider(dbUser.id);
    const photoModel = resolveModel(photoProvider);
    const history = await getRecentMessages(dialog.id, 20);
    const historyMessages: Array<{ role: string; content: MessageContent }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Augment caption with links + search
    const historyForSearch = history.map((m) => ({ role: m.role, content: m.content }));
    const augmentedCaption = await augmentWithLinksAndSearch(
      fullCaption, historyForSearch, ctx
    );

    const userContent: ContentPart[] = [
      { type: "image_url", image_url: { url: dataUrl } },
      { type: "text", text: augmentedCaption },
    ];

    const messages: Array<{ role: string; content: MessageContent }> = [
      ...historyMessages,
      { role: "user", content: userContent },
    ];

    const result = await chatCompletion(messages, NEURO_VISION_MODEL);

    // Save text-only representation to history (original text only)
    const userEntry = prependText
      ? `${prependText}[Фото] ${caption}`
      : `[Фото] ${caption}`;
    await saveMessage(dbUser.id, dialog.id, "user", userEntry);
    await saveMessage(dbUser.id, dialog.id, "assistant", result.content, NEURO_VISION_MODEL, result.tokensUsed ?? undefined);

    // Auto-name dialog on first message (uses user's chat model, not vision model)
    if (dialog.title === "Новый диалог") {
      autoNameDialog(dialog.id, caption, photoModel);
    }

    const chunks = splitMessage(result.content);
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

/** Handle document messages in neuro mode. */
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

  // Flush pending text batch if any
  let prependText = "";
  if (hasPendingBatch(dbUser.id)) {
    const pending = flushBatchSync(dbUser.id);
    if (pending) prependText = pending.combinedText + "\n\n";
  }

  const caption = ctx.message.caption || "Проанализируй содержимое документа";
  const fullCaption = prependText ? prependText + caption : caption;
  const fileName = doc.file_name || "document";
  const mimeType = doc.mime_type || "";
  const fileSize = doc.file_size || 0;

  // Check file size
  if (fileSize > MAX_FILE_SIZE) {
    await ctx.reply(`❌ Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(1)} МБ). Максимум — 15 МБ.`);
    return;
  }

  try {
    await ctx.sendChatAction("typing");

    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Failed to download document: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";

    // Determine processing strategy
    const isImage = IMAGE_MIME_PREFIXES.some((p) => mimeType.startsWith(p));
    const isGeminiDoc = GEMINI_DOC_MIME_TYPES.has(mimeType);
    const isText = TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(ext);

    const dialog = await getOrCreateActiveDialog(dbUser.id);
    const docProviderPref = await getChatProvider(dbUser.id);
    const docTitleModel = resolveModel(docProviderPref);
    const history = await getRecentMessages(dialog.id, 20);
    const historyMessages: Array<{ role: string; content: MessageContent }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Augment caption with links + search
    const historyForSearch = history.map((m) => ({ role: m.role, content: m.content }));
    const augmentedCaption = await augmentWithLinksAndSearch(
      fullCaption, historyForSearch, ctx
    );

    let result;
    let modelUsed: string;

    if (isImage) {
      // Image document — send as base64 to vision model
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const userContent: ContentPart[] = [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: augmentedCaption },
      ];

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userContent },
      ];

      result = await chatCompletion(messages, NEURO_VISION_MODEL);
      modelUsed = NEURO_VISION_MODEL;
    } else if (isGeminiDoc) {
      // PDF, DOCX, XLSX — send as base64 to Gemini (native support)
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const userContent: ContentPart[] = [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: augmentedCaption },
      ];

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userContent },
      ];

      result = await chatCompletion(messages, NEURO_VISION_MODEL);
      modelUsed = NEURO_VISION_MODEL;
    } else if (isText) {
      // Text file — read as UTF-8 and send to DeepSeek
      const textContent = buffer.toString("utf-8");
      const truncated = textContent.length > 50000
        ? textContent.slice(0, 50000) + "\n\n[...файл обрезан, показаны первые 50000 символов]"
        : textContent;

      const userMessage = `Файл: ${fileName}\n\n\`\`\`\n${truncated}\n\`\`\`\n\n${augmentedCaption}`;

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userMessage },
      ];

      result = await chatCompletion(messages, docTitleModel);
      modelUsed = docTitleModel;
    } else {
      // Unsupported format
      await ctx.reply(
        `❌ Формат файла не поддерживается: ${mimeType || ext || "неизвестный"}\n\n` +
        "Поддерживаемые форматы: изображения, PDF, DOCX, XLSX, текстовые файлы (.txt, .csv, .json, .md, .xml, .html)."
      );
      return;
    }

    // Save text-only representation to history (original text only)
    const userEntry = prependText
      ? `${prependText}[Документ: ${fileName}] ${caption}`
      : `[Документ: ${fileName}] ${caption}`;
    await saveMessage(dbUser.id, dialog.id, "user", userEntry);
    await saveMessage(dbUser.id, dialog.id, "assistant", result.content, modelUsed, result.tokensUsed ?? undefined);

    // Auto-name dialog on first message (uses user's chat model, not vision model)
    if (dialog.title === "Новый диалог") {
      autoNameDialog(dialog.id, `${fileName}: ${caption}`, docTitleModel);
    }

    const chunks = splitMessage(result.content);
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

/** Handle provider toggle button (🆓 Free / 💎 Paid). */
export async function handleProviderToggle(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const current = await getChatProvider(dbUser.id);
  const next: ChatProvider = current === "free" ? "paid" : "free";
  await setChatProvider(dbUser.id, next);

  const isAdmin = isBootstrapAdmin(telegramId);
  const label = next === "free"
    ? "🆓 *Free* — бесплатная модель DeepSeek (rate-limited)"
    : "💎 *Paid* — платная модель DeepSeek (быстрее, без лимитов)";

  await ctx.reply(
    `Модель переключена: ${label}`,
    { parse_mode: "Markdown", ...getNeuroKeyboard(isAdmin, next) }
  );
}
