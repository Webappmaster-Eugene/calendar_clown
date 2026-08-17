import type { FlushedBatch } from "./messageBatcher.js";
import { chatCompletion, generateDialogTitle } from "./client.js";
import {
  getOrCreateActiveDialog,
  getDialogById,
  getRecentMessages,
  saveMessage,
  updateDialogTitle,
  getChatProvider,
  isDialogAtMessageLimit,
} from "./repository.js";
import { resolveDialogAiConfig, CHAT_LIMIT_REACHED_MSG } from "./config.js";
import { augmentUserMessage, isWebSearchConfigured } from "./augment.js";
import { resolveWebSearchStrategy } from "./webSearchStrategy.js";
import { splitMessage } from "../utils/telegram.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-processor");

export async function processNeuroRequest(batch: FlushedBatch): Promise<void> {
  const { combinedText, ctx, dialogId, dbUserId } = batch;

  try {
    const statusMsg = await ctx.reply("⏳ Обрабатываю запрос...");
    const statusMsgId = statusMsg.message_id;
    const chatId = ctx.chat!.id;

    const editStatus = async (text: string): Promise<void> => {
      try {
        await ctx.telegram.editMessageText(chatId, statusMsgId, undefined, text);
      } catch {
        // Status edit may fail if the message was deleted.
      }
    };

    // Use the dialogId captured when the user sent the message, not the current
    // active dialog (which may have changed since batching).
    const dialog = (dialogId ? await getDialogById(dialogId, dbUserId) : null)
      ?? await getOrCreateActiveDialog(dbUserId);

    // Re-check here (not only on send): the Mini App could have filled the dialog
    // up while the batch was waiting out its debounce.
    if (await isDialogAtMessageLimit(dialog.id)) {
      await editStatus(`⚠️ ${CHAT_LIMIT_REACHED_MSG}`);
      return;
    }

    const history = await getRecentMessages(dialog.id);
    const historyMessages = history.map((m) => ({ role: m.role, content: m.content }));

    // Resolved at flush time, so switching provider or model while the batch waits
    // applies to it (instead of using a value captured at the first message).
    const provider = await getChatProvider(dbUserId);
    const { model, persona, uncensored } = resolveDialogAiConfig(dialog, provider);
    const searchStrategy = resolveWebSearchStrategy(model, { tavilyConfigured: isWebSearchConfigured() });

    const augmented = await augmentUserMessage({
      text: combinedText,
      history: historyMessages,
      onStatus: (s) => editStatus(s.label),
      searchStrategy,
    });

    const messages = [
      ...historyMessages,
      { role: "user", content: augmented.augmentedText },
    ];

    const result = await chatCompletion(messages, {
      model,
      persona,
      uncensored,
      webSearch: searchStrategy,
    });

    // Save original text without search/links context.
    await saveMessage(dbUserId, dialog.id, "user", combinedText);
    await saveMessage(dbUserId, dialog.id, "assistant", result.content, model, result.tokensUsed ?? undefined);

    if (dialog.title === "Новый диалог") {
      generateDialogTitle(combinedText, model)
        .then((title) => {
          if (title && title !== "Новый диалог") {
            return updateDialogTitle(dialog.id, title);
          }
        })
        .catch((err) => log.error("Failed to auto-name dialog:", err));
    }

    const chunks = splitMessage(result.content);

    try {
      await ctx.telegram.editMessageText(
        chatId, statusMsgId, undefined,
        chunks[0],
        { parse_mode: "Markdown" }
      );
    } catch {
      try {
        await ctx.telegram.editMessageText(
          chatId, statusMsgId, undefined,
          chunks[0]
        );
      } catch {
        // If edit fails completely, send as new message
        try {
          await ctx.replyWithMarkdown(chunks[0]);
        } catch {
          await ctx.reply(chunks[0]);
        }
      }
    }

    for (let i = 1; i < chunks.length; i++) {
      try {
        await ctx.replyWithMarkdown(chunks[i]);
      } catch {
        await ctx.reply(chunks[i]);
      }
    }
  } catch (err) {
    log.error("Neuro processor error:", err);
    try {
      await ctx.reply("❌ Ошибка при обработке запроса. Попробуйте позже.");
    } catch {
      // If even error reply fails, just log
      log.error("Failed to send error reply");
    }
  }
}
