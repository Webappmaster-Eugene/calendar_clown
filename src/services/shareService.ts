import { randomUUID } from "crypto";
import { getDialogById, getMessageById } from "../chat/repository.js";
import { buildShareMessageText } from "../chat/shareText.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import {
  savePreparedInlineMessage,
  isEntityParseError,
  TelegramApiUnavailableError,
} from "../utils/telegramApi.js";
import { createLogger } from "../utils/logger.js";
import type { PreparedShareDto } from "../shared/types.js";

const log = createLogger("share-service");

export class ShareNotFoundError extends Error {
  constructor(message = "Сообщение не найдено.") {
    super(message);
    this.name = "ShareNotFoundError";
  }
}

export { TelegramApiUnavailableError };

/** Prepares one assistant answer for Telegram's native "share to chat" picker.
 *  The text is read from the DB by (dialogId, messageId, userId) — never accepted
 *  from the client — so a user can only share their own messages. */
export async function prepareChatMessageShare(
  telegramId: number,
  dialogId: number,
  messageId: number
): Promise<PreparedShareDto> {
  if (!isDatabaseAvailable()) throw new Error("База данных недоступна.");

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) throw new Error("Пользователь не найден.");

  const dialog = await getDialogById(dialogId, dbUser.id);
  if (!dialog) throw new ShareNotFoundError("Диалог не найден.");

  const message = await getMessageById(messageId, dialogId, dbUser.id);
  if (!message) throw new ShareNotFoundError();

  const { text, truncated } = buildShareMessageText(message.content);
  if (!text) throw new ShareNotFoundError("Сообщение пустое.");

  const result = {
    type: "article" as const,
    id: randomUUID(),
    title: dialog.title.slice(0, 64),
    input_message_content: { message_text: text, parse_mode: "Markdown" as const },
  };
  const allow = {
    allow_user_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true,
    allow_bot_chats: false,
  };

  let prepared;
  try {
    prepared = await savePreparedInlineMessage({ user_id: telegramId, result, ...allow });
  } catch (err) {
    // LLM Markdown regularly fails Telegram's parser; retrying as plain text costs
    // nothing because nothing is sent until the user picks a chat.
    if (!isEntityParseError(err)) throw err;
    log.warn("Markdown rejected for the prepared share message, retrying as plain text");
    prepared = await savePreparedInlineMessage({
      user_id: telegramId,
      result: { ...result, input_message_content: { message_text: text } },
      ...allow,
    });
  }

  return {
    preparedMessageId: prepared.id,
    expiresAt: prepared.expiration_date
      ? new Date(prepared.expiration_date * 1000).toISOString()
      : null,
    truncated,
  };
}
