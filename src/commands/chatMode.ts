import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { setUserMode } from "../middleware/userMode.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { saveMessage, getRecentMessages, clearHistory } from "../chat/repository.js";
import { chatCompletion } from "../chat/client.js";
import { splitMessage } from "../utils/telegram.js";
import { setModeMenuCommands, getModeButtons } from "./expenseMode.js";
import { DEEPSEEK_MODEL, NEURO_VISION_MODEL } from "../constants.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import type { ContentPart, MessageContent } from "../utils/openRouterClient.js";

const log = createLogger("neuro");

/** Max file size for document processing (15 MB). */
const MAX_FILE_SIZE = 15 * 1024 * 1024;

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

function getNeuroKeyboard(isAdmin: boolean) {
  return Markup.keyboard([
    ["🗑 Очистить историю"],
    ...getModeButtons(isAdmin),
  ]).resize();
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
  await ctx.reply(
    "🧠 *Режим Нейро активирован*\n\n" +
    "Отправьте текст, голосовое, фото или документ — я отвечу с помощью AI.\n" +
    "Поддерживаемые форматы: изображения, PDF, DOCX, XLSX, текстовые файлы.\n" +
    "Я помню последние 10 сообщений диалога.",
    { parse_mode: "Markdown", ...getNeuroKeyboard(isAdmin) }
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
    await ctx.sendChatAction("typing");

    const history = await getRecentMessages(dbUser.id);
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ];

    const result = await chatCompletion(messages);

    await saveMessage(dbUser.id, "user", userText);
    await saveMessage(dbUser.id, "assistant", result.content, DEEPSEEK_MODEL, result.tokensUsed ?? undefined);

    const chunks = splitMessage(result.content);
    for (const chunk of chunks) {
      try {
        await ctx.replyWithMarkdown(chunk);
      } catch {
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    console.error("Neuro chat error:", err);
    await ctx.reply("❌ Ошибка при обработке запроса. Попробуйте позже.");
  }

  return true;
}

/** Handle "🗑 Очистить историю" button. */
export async function handleNeuroClearButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  if (!isDatabaseAvailable()) {
    await ctx.reply("⚠️ База данных недоступна.");
    return;
  }

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) return;

  const deleted = await clearHistory(dbUser.id);
  await ctx.reply(`🗑 История очищена (удалено ${deleted} сообщений).`);
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
    const history = await getRecentMessages(dbUser.id);
    const messages: Array<{ role: string; content: string }> = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: transcript },
    ];

    const result = await chatCompletion(messages);

    const userEntry = `[Голос] ${transcript}`;
    await saveMessage(dbUser.id, "user", userEntry);
    await saveMessage(dbUser.id, "assistant", result.content, DEEPSEEK_MODEL, result.tokensUsed ?? undefined);

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

  const caption = ctx.message.caption || "Опиши что на изображении";

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
    const history = await getRecentMessages(dbUser.id);
    const historyMessages: Array<{ role: string; content: MessageContent }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const userContent: ContentPart[] = [
      { type: "image_url", image_url: { url: dataUrl } },
      { type: "text", text: caption },
    ];

    const messages: Array<{ role: string; content: MessageContent }> = [
      ...historyMessages,
      { role: "user", content: userContent },
    ];

    const result = await chatCompletion(messages, NEURO_VISION_MODEL);

    // Save text-only representation to history
    const userEntry = `[Фото] ${caption}`;
    await saveMessage(dbUser.id, "user", userEntry);
    await saveMessage(dbUser.id, "assistant", result.content, NEURO_VISION_MODEL, result.tokensUsed ?? undefined);

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

  const caption = ctx.message.caption || "Проанализируй содержимое документа";
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

    const history = await getRecentMessages(dbUser.id);
    const historyMessages: Array<{ role: string; content: MessageContent }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let result;
    let modelUsed: string;

    if (isImage) {
      // Image document — send as base64 to vision model
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const userContent: ContentPart[] = [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: caption },
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
        { type: "text", text: caption },
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

      const userMessage = `Файл: ${fileName}\n\n\`\`\`\n${truncated}\n\`\`\`\n\n${caption}`;

      const messages: Array<{ role: string; content: MessageContent }> = [
        ...historyMessages,
        { role: "user", content: userMessage },
      ];

      result = await chatCompletion(messages);
      modelUsed = DEEPSEEK_MODEL;
    } else {
      // Unsupported format
      await ctx.reply(
        `❌ Формат файла не поддерживается: ${mimeType || ext || "неизвестный"}\n\n` +
        "Поддерживаемые форматы: изображения, PDF, DOCX, XLSX, текстовые файлы (.txt, .csv, .json, .md, .xml, .html)."
      );
      return;
    }

    // Save text-only representation to history
    const userEntry = `[Документ: ${fileName}] ${caption}`;
    await saveMessage(dbUser.id, "user", userEntry);
    await saveMessage(dbUser.id, "assistant", result.content, modelUsed, result.tokensUsed ?? undefined);

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
