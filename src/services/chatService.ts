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
  countDialogMessages,
  type ChatDialog,
} from "../chat/repository.js";
import { chatCompletion, chatCompletionStream, generateDialogTitle, buildUncensoredSystemPrompt } from "../chat/client.js";
import { getChatProvider } from "../chat/repository.js";
import { searchModels, listModelVendors } from "../chat/models.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DEEPSEEK_MODEL, DEEPSEEK_FREE_MODEL, NEURO_UNCENSORED_MODEL, CHAT_MESSAGE_LIMIT, CHAT_MAX_DIALOGS } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  ChatProvider,
  ChatDialogDto,
  ChatMessageDto,
  SendChatMessageResponse,
  UpdateDialogRequest,
  OpenRouterModelDto,
  ChatConfigDto,
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

export function resolveDialogAiConfig(
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

export async function getModels(
  search: string,
  opts: { free?: boolean; vendor?: string } = {}
): Promise<OpenRouterModelDto[]> {
  return searchModels(search, opts);
}

export async function getModelVendors(): Promise<string[]> {
  return listModelVendors();
}

export function getChatConfig(): ChatConfigDto {
  return { messageLimit: CHAT_MESSAGE_LIMIT, maxDialogs: CHAT_MAX_DIALOGS };
}

export async function getDialogMessages(
  telegramId: number,
  dialogId: number,
  limit: number = CHAT_MESSAGE_LIMIT
): Promise<ChatMessageDto[]> {
  requireDb();
  const dbUser = await requireDbUser(telegramId);

  const dialog = await getDialogById(dialogId, dbUser.id);
  if (!dialog) throw new Error("Диалог не найден.");

  const messages = await getRecentMessages(dialogId, limit);
  return messages.map(messageToDto);
}

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

  // Reject writes to a dialog that has hit the message cap (= the context window,
  // so nothing is silently forgotten). The user must start a new chat.
  if ((await countDialogMessages(dialog.id)) >= CHAT_MESSAGE_LIMIT) {
    throw new Error(`Диалог достиг лимита в ${CHAT_MESSAGE_LIMIT} сообщений. Начните новый чат.`);
  }

  // Read history BEFORE saving the user message so it isn't duplicated into context.
  const history = await getRecentMessages(dialog.id, CHAT_MESSAGE_LIMIT);
  const messages = [
    ...history.map((m) => ({
      role: m.role,
      content: m.content as string,
    })),
    { role: "user", content },
  ];

  // Call AI first — a failure must not leave an orphaned user message saved.
  const result = await chatCompletion(messages, model, systemPrompt, { temperature, maxTokens });

  const userMsg = await saveMessage(dbUser.id, dialog.id, "user", content);
  const assistantMsg = await saveMessage(
    dbUser.id,
    dialog.id,
    "assistant",
    result.content,
    model,
    result.tokensUsed ?? undefined
  );

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

  // Reject writes to a dialog that has hit the message cap (= the context window,
  // so nothing is silently forgotten). The user must start a new chat.
  if ((await countDialogMessages(dialog.id)) >= CHAT_MESSAGE_LIMIT) {
    throw new Error(`Диалог достиг лимита в ${CHAT_MESSAGE_LIMIT} сообщений. Начните новый чат.`);
  }

  // Read history BEFORE saving the user message so it isn't duplicated into context.
  const history = await getRecentMessages(dialog.id, CHAT_MESSAGE_LIMIT);
  const messages = [
    ...history.map((m) => ({
      role: m.role,
      content: m.content as string,
    })),
    { role: "user", content },
  ];

  // Stream AI first — a failure must not leave an orphaned user message saved.
  const result = await chatCompletionStream(messages, onChunk, model, systemPrompt, { temperature, maxTokens });

  const userMsg = await saveMessage(dbUser.id, dialog.id, "user", content);
  const assistantMsg = await saveMessage(
    dbUser.id,
    dialog.id,
    "assistant",
    result.content,
    model,
    result.tokensUsed ?? undefined
  );

  // Fire-and-forget to avoid blocking the SSE "done" event.
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
