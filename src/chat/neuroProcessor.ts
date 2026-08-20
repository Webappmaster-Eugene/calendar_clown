import type { FlushedBatch } from "./messageBatcher.js";
import { chatCompletionStream, generateDialogTitle } from "./client.js";
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
import { StreamingReply } from "./streamingReply.js";
import type { StreamResult } from "../utils/openRouterClient.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-processor");

/** Appended to a partially streamed answer whose stream died mid-flight. */
export const STREAM_INTERRUPTED_NOTE = "\n\n⚠️ _Ответ оборван: соединение с моделью прервалось._";

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

    const reply = new StreamingReply({
      telegram: ctx.telegram,
      chatId,
      messageId: statusMsgId,
    });

    let result: StreamResult;
    try {
      result = await chatCompletionStream(messages, (delta) => reply.push(delta), {
        model,
        persona,
        uncensored,
        webSearch: searchStrategy,
      });
    } catch (err) {
      // Part of the answer may already be on screen and cannot be recalled, so
      // keep it — and persist it, or the history would disagree with the chat.
      const partial = reply.text;
      if (!partial.trim()) throw err;
      log.error("Neuro stream interrupted, keeping the partial answer:", err);
      // The note is for the reader only — saving it would feed it back to the
      // model as part of its own previous turn.
      await reply.finish(STREAM_INTERRUPTED_NOTE);
      await saveMessage(dbUserId, dialog.id, "user", combinedText);
      await saveMessage(dbUserId, dialog.id, "assistant", partial, model);
      return;
    }

    await reply.finish();

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
