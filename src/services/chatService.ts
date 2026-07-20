/**
 * Chat (Neuro) business logic extracted from command handlers.
 * Used by both Telegraf bot handlers and REST API routes.
 */
import {
  saveMessage,
  getRecentMessages,
  getOrCreateActiveDialog,
  getDialogsByUser,
  createDialog,
  deleteDialog,
  getDialogById,
  setActiveDialogId,
  updateDialogTitle,
  renameDialog,
  updateDialogSettings,
  type ChatDialog,
} from "../chat/repository.js";
import { chatCompletion, chatCompletionStream, generateDialogTitle, buildUncensoredSystemPrompt } from "../chat/client.js";
import { getChatProvider } from "../chat/repository.js";
import { searchModels } from "../chat/models.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DEEPSEEK_MODEL, DEEPSEEK_FREE_MODEL, NEURO_UNCENSORED_MODEL } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  ChatProvider,
  ChatDialogDto,
  ChatMessageDto,
  SendChatMessageResponse,
  UpdateDialogRequest,
  OpenRouterModelDto,
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

/**
 * Effective AI config for a dialog: per-dialog overrides win, otherwise the user's
 * global provider preference. Model → dialog.model or the provider model; system
 * prompt → dialog.systemPrompt or the provider's; temperature/maxTokens → dialog-only.
 */
function resolveDialogAiConfig(
  dialog: ChatDialog,
  provider: ChatProvider
): { model: string; systemPrompt?: string; temperature?: number; maxTokens?: number } {
  const base = resolveModelAndPrompt(provider);
  return {
    model: dialog.model || base.model,
    systemPrompt: dialog.systemPrompt ?? base.systemPrompt,
    temperature: dialog.temperature ?? undefined,
    maxTokens: dialog.maxTokens ?? undefined,
  };
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

function dialogToDto(d: ChatDialog, messageCount?: number): ChatDialogDto {
  return {
    id: d.id,
    title: d.title,
    isActive: d.isActive,
    messageCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    model: d.model,
    systemPrompt: d.systemPrompt,
    temperature: d.temperature,
    maxTokens: d.maxTokens,
    theme: d.theme,
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

export async function getUserDialogs(telegramId: number): Promise<ChatDialogDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dialogs = await getDialogsByUser(dbUser.id);
  return dialogs.map((d) => dialogToDto(d, d.messageCount));
}

export async function createNewDialog(telegramId: number, title?: string): Promise<ChatDialogDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const dialog = await createDialog(dbUser.id, title);
  await setActiveDialogId(dbUser.id, dialog.id);
  return dialogToDto(dialog);
}

export async function removeDialog(telegramId: number, dialogId: number): Promise<void> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  await deleteDialog(dialogId, dbUser.id);
}

/** Rename a dialog owned by the given user. Throws if the dialog is not found or not owned. */
export async function renameUserDialog(
  telegramId: number,
  dialogId: number,
  title: string
): Promise<void> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const updated = await renameDialog(dialogId, dbUser.id, title);
  if (!updated) throw new Error("Диалог не найден.");
}

/** Update a dialog's title + per-dialog AI settings (model/prompt/temp/max/theme). */
export async function updateDialogForUser(
  telegramId: number,
  dialogId: number,
  patch: UpdateDialogRequest
): Promise<ChatDialogDto> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);
  const updated = await updateDialogSettings(dialogId, dbUser.id, patch);
  if (!updated) throw new Error("Диалог не найден.");
  return dialogToDto(updated);
}

/** OpenRouter model catalog for the picker, optionally filtered by a search query. */
export async function getModels(search: string): Promise<OpenRouterModelDto[]> {
  return searchModels(search);
}

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

  let dialog;
  if (dialogId) {
    dialog = await getDialogById(dialogId, dbUser.id);
    if (!dialog) throw new Error("Диалог не найден.");
  } else {
    dialog = await getOrCreateActiveDialog(dbUser.id);
  }

  const provider = await getChatProvider(dbUser.id);
  const { model, systemPrompt, temperature, maxTokens } = resolveDialogAiConfig(dialog, provider);

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
  const result = await chatCompletion(messages, model, systemPrompt, { temperature, maxTokens });

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

  let dialog;
  if (dialogId) {
    dialog = await getDialogById(dialogId, dbUser.id);
    if (!dialog) throw new Error("Диалог не найден.");
  } else {
    dialog = await getOrCreateActiveDialog(dbUser.id);
  }

  const provider = await getChatProvider(dbUser.id);
  const { model, systemPrompt, temperature, maxTokens } = resolveDialogAiConfig(dialog, provider);

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
  const result = await chatCompletionStream(messages, onChunk, model, systemPrompt, { temperature, maxTokens });

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
