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
import { chatCompletion, generateDialogTitle } from "../chat/client.js";
import { getChatProvider } from "../chat/repository.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DEEPSEEK_MODEL, DEEPSEEK_FREE_MODEL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  ChatDialogDto,
  ChatMessageDto,
  SendChatMessageResponse,
} from "../shared/types.js";

const log = createLogger("chat-service");

// ─── Helpers ──────────────────────────────────────────────────

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
  return dialogs.map((d) => dialogToDto(d));
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
  const model = provider === "free" ? DEEPSEEK_FREE_MODEL : DEEPSEEK_MODEL;

  // Save user message
  const userMsg = await saveMessage(dbUser.id, dialog.id, "user", content);

  // Get conversation history
  const history = await getRecentMessages(dialog.id, 20);
  const messages = history.map((m) => ({
    role: m.role,
    content: m.content as string,
  }));

  // Call AI
  const result = await chatCompletion(messages, model);

  // Save assistant response
  const assistantMsg = await saveMessage(
    dbUser.id,
    dialog.id,
    "assistant",
    result.content,
    model,
    result.tokensUsed ?? undefined
  );

  // Auto-generate title for new dialogs
  if (history.length <= 1) {
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
 * Clear dialog history.
 */
export async function clearHistory(telegramId: number, dialogId: number): Promise<number> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  return clearDialogHistory(dialogId, dbUser.id);
}
