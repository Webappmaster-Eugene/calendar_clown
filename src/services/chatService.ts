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
import { chatCompletion, chatCompletionStream, generateDialogTitle } from "../chat/client.js";
import { getChatProvider, isDialogAtMessageLimit } from "../chat/repository.js";
import { resolveDialogAiConfig, CHAT_LIMIT_REACHED_MSG } from "../chat/config.js";
import { augmentUserMessage, isWebSearchConfigured, type AugmentStatus } from "../chat/augment.js";
import { resolveWebSearchStrategy, resolveWebSearchMode } from "../chat/webSearchStrategy.js";
import { searchModels, listModelVendors } from "../chat/models.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { CHAT_MESSAGE_LIMIT, CHAT_MAX_DIALOGS } from "../constants.js";
import { createLogger } from "../utils/logger.js";
import type {
  ChatDialogDto,
  ChatMessageDto,
  SendChatMessageResponse,
  UpdateDialogRequest,
  OpenRouterModelDto,
  ChatConfigDto,
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
  // Native search needs no Tavily key, so the flag can't be a plain key probe.
  const mode = resolveWebSearchMode();
  const nativePossible = mode === "auto" || mode === "openrouter";
  return {
    messageLimit: CHAT_MESSAGE_LIMIT,
    maxDialogs: CHAT_MAX_DIALOGS,
    webSearchAvailable: mode !== "off" && (nativePossible || isWebSearchConfigured()),
  };
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
  const { model, persona, uncensored } = resolveDialogAiConfig(dialog, provider);

  if (await isDialogAtMessageLimit(dialog.id)) {
    throw new Error(CHAT_LIMIT_REACHED_MSG);
  }

  // Read history BEFORE saving the user message so it isn't duplicated into context.
  const history = await getRecentMessages(dialog.id, CHAT_MESSAGE_LIMIT);
  const historyMessages = history.map((m) => ({ role: m.role, content: m.content as string }));

  const searchStrategy = resolveWebSearchStrategy(model, { tavilyConfigured: isWebSearchConfigured() });
  const augmented = await augmentUserMessage({ text: content, history: historyMessages, searchStrategy });
  const messages = [...historyMessages, { role: "user", content: augmented.augmentedText }];

  // Call AI first — a failure must not leave an orphaned user message saved.
  const result = await chatCompletion(messages, {
    model,
    persona,
    uncensored,
    webSearch: searchStrategy,
  });

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
  dialogId?: number,
  onStatus?: (status: AugmentStatus) => void | Promise<void>
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
  const { model, persona, uncensored } = resolveDialogAiConfig(dialog, provider);

  if (await isDialogAtMessageLimit(dialog.id)) {
    throw new Error(CHAT_LIMIT_REACHED_MSG);
  }

  // Read history BEFORE saving the user message so it isn't duplicated into context.
  const history = await getRecentMessages(dialog.id, CHAT_MESSAGE_LIMIT);
  const historyMessages = history.map((m) => ({ role: m.role, content: m.content as string }));

  const searchStrategy = resolveWebSearchStrategy(model, { tavilyConfigured: isWebSearchConfigured() });
  const augmented = await augmentUserMessage({ text: content, history: historyMessages, onStatus, searchStrategy });
  const messages = [...historyMessages, { role: "user", content: augmented.augmentedText }];

  // Stream AI first — a failure must not leave an orphaned user message saved.
  const result = await chatCompletionStream(messages, onChunk, {
    model,
    persona,
    uncensored,
    webSearch: searchStrategy,
  });

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
