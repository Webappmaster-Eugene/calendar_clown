import type { FlushedBatch } from "./messageBatcher.js";
import { chatCompletion, generateDialogTitle } from "./client.js";
import {
  getOrCreateActiveDialog,
  getDialogById,
  getRecentMessages,
  saveMessage,
  updateDialogTitle,
  getChatProvider,
} from "./repository.js";
import { extractUrls, fetchLinksContent, formatLinksForContext } from "./linkAnalyzer.js";
import { classifySearchNeed, executeWebSearch, formatSearchResultsForContext } from "./webSearch.js";
import { splitMessage } from "../utils/telegram.js";
import { DEEPSEEK_MODEL, DEEPSEEK_FREE_MODEL } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("neuro-processor");

/** Max total context from search + links to avoid exceeding model limits. */
const MAX_AUGMENTED_CONTEXT_LENGTH = 15_000;

/** Process a flushed batch: links, search, AI, reply. */
export async function processNeuroRequest(batch: FlushedBatch): Promise<void> {
  const { combinedText, ctx, dialogId, dbUserId, model: batchModel } = batch;

  try {
    // 1. Send status message
    const statusMsg = await ctx.reply("⏳ Обрабатываю запрос...");
    const statusMsgId = statusMsg.message_id;
    const chatId = ctx.chat!.id;

    // 2. Get dialog & history — use the dialogId captured when the user sent the message,
    //    not the current active dialog (which may have changed since batching)
    const dialog = (dialogId ? await getDialogById(dialogId, dbUserId) : null)
      ?? await getOrCreateActiveDialog(dbUserId);
    const history = await getRecentMessages(dialog.id, 20);
    const historyMessages = history.map((m) => ({ role: m.role, content: m.content }));

    // 3. Parallel: extract URLs + classify search need
    const urls = extractUrls(combinedText);

    const [linksResult, searchClassification] = await Promise.all([
      urls.length > 0 ? fetchLinksContent(urls) : Promise.resolve([]),
      classifySearchNeed(combinedText, historyMessages),
    ]);

    // 4. If search is needed, execute it
    let searchResults: Awaited<ReturnType<typeof executeWebSearch>> | null = null;
    if (searchClassification.needsSearch && searchClassification.queries.length > 0) {
      try {
        await ctx.telegram.editMessageText(
          chatId, statusMsgId, undefined,
          "🔍 Ищу информацию..."
        );
      } catch {
        // Status edit may fail if message was deleted
      }
      searchResults = await executeWebSearch(searchClassification.queries);
    }

    // 5. Build augmented message
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

    const augmentedParts = [combinedText];
    if (linksContext) augmentedParts.push(linksContext);
    if (searchContext) augmentedParts.push(searchContext);
    const augmentedMessage = augmentedParts.join("\n\n");

    // 5.5. Resolve model: from batch or from user's chat provider
    let model = batchModel;
    if (!model) {
      const provider = await getChatProvider(dbUserId);
      model = provider === "free" ? DEEPSEEK_FREE_MODEL : DEEPSEEK_MODEL;
    }

    // 6. Call AI
    const messages = [
      ...historyMessages,
      { role: "user", content: augmentedMessage },
    ];

    const result = await chatCompletion(messages, model);

    // 7. Save original text to DB (without search/links context)
    await saveMessage(dbUserId, dialog.id, "user", combinedText);
    await saveMessage(dbUserId, dialog.id, "assistant", result.content, model, result.tokensUsed ?? undefined);

    // 8. Auto-name dialog (fire-and-forget)
    if (dialog.title === "Новый диалог") {
      generateDialogTitle(combinedText, model)
        .then((title) => {
          if (title && title !== "Новый диалог") {
            return updateDialogTitle(dialog.id, title);
          }
        })
        .catch((err) => log.error("Failed to auto-name dialog:", err));
    }

    // 9. Reply — edit status message with first chunk, send rest as new messages
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
