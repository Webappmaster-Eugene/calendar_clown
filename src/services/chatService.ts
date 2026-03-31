/**
 * Chat (Neuro) business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
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
} from "../chat/repository.js";
import { chatCompletion, chatCompletionStream, generateDialogTitle, buildUncensoredSystemPrompt } from "../chat/client.js";
import { getChatProvider } from "../chat/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DEEPSEEK_MODEL, DEEPSEEK_FREE_MODEL, NEURO_UNCENSORED_MODEL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  ChatProvider,
  ChatDialogDto,
  ChatMessageDto,
  SendChatMessageResponse,
} from "../shared/types.js";

const log = createLogger("chat-service");

// ─── Helpers ──────────────────────────────────────────────────

function resolveModelAndPrompt(provider: ChatProvider): { model: string; systemPrompt?: string } {
  switch (provider) {
    case "free": return { model: DEEPSEEK_FREE_MODEL };
    case "paid": return { model: DEEPSEEK_MODEL };
    case "uncensored": return { model: NEURO_UNCENSORED_MODEL, systemPrompt: buildUncensoredSystemPrompt() };
  }
}

function requireDb(): void {
  if (!isDatabaseAvailable()) {
    throw new Error("База данных недоступна.");
  }
}

async function requireDbUser(telegramId: number) {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");
  return dbUser;
}

function dialogToDto(d: { id: number; title: string; isActive: boolean; createdAt: Date; updatedAt: Date }, messageCount?: number): ChatDialogDto {
  return {
    id: d.id,
    title: d.title,
    isActive: d.isActive,
    messageCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function messageToDto(m: { id: number; dialogId: number; role: "user" | "assistant"; content: string; modelUsed?: string | null; createdAt: Date }): ChatMessageDto {
  return {
    id: m.id,
    dialogId: m.dialogId,
    role: m.role,
    content: m.content,
    ...(m.modelUsed ? { modelUsed: m.modelUsed } : {}),
    createdAt: m.createdAt.toISOString(),
  };
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Get all dialogs for a user.
 */
export async function getUserDialogs(telegramId: number): Promise<ChatDialogDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dialogs = await getDialogsByUser(dbUser.id);
  return dialogs.map((d) => dialogToDto(d, d.messageCount));
}

/**
 * Get the active dialog (or create one).
 */
export async function getActiveDialog(telegramId: number): Promise<ChatDialogDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dialog = await getOrCreateActiveDialog(dbUser.id);
  return dialogToDto(dialog);
}

/**
 * Create a new dialog.
 */
export async function createNewDialog(telegramId: number, title?: string): Promise<ChatDialogDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dialog = await createDialog(dbUser.id, title);
  await setActiveDialogId(dbUser.id, dialog.id);
  return dialogToDto(dialog);
}

/**
 * Switch to a different dialog.
 */
export async function switchDialog(telegramId: number, dialogId: number): Promise<ChatDialogDto | null> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dialog = await getDialogById(dialogId, dbUser.id);
  if (!dialog) return null;

  await setActiveDialogId(dbUser.id, dialogId);
  return dialogToDto(dialog);
}

/**
 * Delete a dialog.
 */
export async function removeDialog(telegramId: number, dialogId: number): Promise<void> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  await deleteDialog(dialogId, dbUser.id);
}

/**
 * Get messages for a dialog.
 */
export async function getDialogMessages(
  telegramId: number,
  dialogId: number,
  limit: number = 20
): Promise<ChatMessageDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Verify ownership
  const dialog = await getDialogById(dialogId, dbUser.id);
  if (!dialog) throw new Error("Диалог не найден.");

  const messages = await getRecentMessages(dialogId, limit);
  return messages.map(messageToDto);
}

/**
 * Send a message and get AI response.
 * This is the core chat function that:
 * 1. Gets or creates the active dialog
 * 2. Saves user message
 * 3. Calls AI
 * 4. Saves AI response
 * 5. Auto-generates dialog title on first message
 */
export async function sendMessage(
  telegramId: number,
  content: string,
  dialogId?: number
): Promise<SendChatMessageResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Get or create dialog
  let dialog;
  if (dialogId) {
    dialog = await getDialogById(dialogId, dbUser.id);
    if (!dialog) throw new Error("Диалог не найден.");
  } else {
    dialog = await getOrCreateActiveDialog(dbUser.id);
  }

  // Resolve model from user's chat provider
  const provider = await getChatProvider(dbUser.id);
  const { model, systemPrompt } = resolveModelAndPrompt(provider);

  // Get conversation history BEFORE saving user message (to build context)
  const history = await getRecentMessages(dialog.id, 20);
  const messages = [
    ...history.map((m) => ({
      role: m.role,
      content: m.content as string,
    })),
    { role: "user", content },
  ];

  // Call AI first — if it fails, we don't save orphaned user messages
  const result = await chatCompletion(messages, model, systemPrompt);

  // Save both messages only after successful AI call
  const userMsg = await saveMessage(dbUser.id, dialog.id, "user", content);
  const assistantMsg = await saveMessage(
    dbUser.id,
    dialog.id,
    "assistant",
    result.content,
    model,
    result.tokensUsed ?? undefined
  );

  // Auto-generate title for new dialogs
  if (history.length === 0) {
    try {
      const title = await generateDialogTitle(content, model);
      if (title) {
        await updateDialogTitle(dialog.id, title.slice(0, 100));
      }
    } catch (err) {
      log.error("Failed to generate dialog title:", err);
    }
  }

  return {
    dialogId: dialog.id,
    userMessage: messageToDto(userMsg),
    assistantMessage: messageToDto(assistantMsg),
  };
}

/**
 * Streaming variant of sendMessage.
 * Prepares the dialog and user message, then streams the AI response via onChunk.
 * After streaming completes, saves the full response to DB.
 */
export async function sendMessageStream(
  telegramId: number,
  content: string,
  onChunk: (text: string) => void | Promise<void>,
  dialogId?: number
): Promise<SendChatMessageResponse> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  // Get or create dialog
  let dialog;
  if (dialogId) {
    dialog = await getDialogById(dialogId, dbUser.id);
    if (!dialog) throw new Error("Диалог не найден.");
  } else {
    dialog = await getOrCreateActiveDialog(dbUser.id);
  }

  // Resolve model from user's chat provider
  const provider = await getChatProvider(dbUser.id);
  const { model, systemPrompt } = resolveModelAndPrompt(provider);

  // Get conversation history BEFORE saving user message (to build context)
  const history = await getRecentMessages(dialog.id, 20);
  const messages = [
    ...history.map((m) => ({
      role: m.role,
      content: m.content as string,
    })),
    { role: "user", content },
  ];

  // Stream AI response first — if it fails, we don't save orphaned user messages
  const result = await chatCompletionStream(messages, onChunk, model, systemPrompt);

  // Save both messages only after successful AI call
  const userMsg = await saveMessage(dbUser.id, dialog.id, "user", content);
  const assistantMsg = await saveMessage(
    dbUser.id,
    dialog.id,
    "assistant",
    result.content,
    model,
    result.tokensUsed ?? undefined
  );

  // Auto-generate title for new dialogs (fire-and-forget to avoid blocking the SSE "done" event)
  if (history.length === 0) {
    generateDialogTitle(content, model)
      .then((title) => {
        if (title) return updateDialogTitle(dialog.id, title.slice(0, 100));
      })
      .catch((err) => log.error("Failed to generate dialog title:", err));
  }

  return {
    dialogId: dialog.id,
    userMessage: messageToDto(userMsg),
    assistantMessage: messageToDto(assistantMsg),
  };
}

/**
 * Clear dialog history.
 */
export async function clearHistory(telegramId: number, dialogId: number): Promise<number> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return clearDialogHistory(dialogId, dbUser.id);
}
