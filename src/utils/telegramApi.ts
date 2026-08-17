import { getBotInstance } from "../botInstance.js";
import { createLogger } from "./logger.js";

const log = createLogger("telegram-api");

// Bot API 8.0 methods that Telegraf 4.16 does not type yet. Calls go through
// Telegraf's own client so they inherit the bot token AND the proxy agent
// (mandatory: the prod host is geo-blocked for api.telegram.org).

export class TelegramApiUnavailableError extends Error {
  constructor(message = "Бот не инициализирован.") {
    super(message);
    this.name = "TelegramApiUnavailableError";
  }
}

export interface InlineQueryResultArticleLike {
  type: "article";
  id: string;
  title: string;
  input_message_content: {
    message_text: string;
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  };
  description?: string;
}

export interface SavePreparedInlineMessageParams {
  user_id: number;
  result: InlineQueryResultArticleLike;
  allow_user_chats?: boolean;
  allow_bot_chats?: boolean;
  allow_group_chats?: boolean;
  allow_channel_chats?: boolean;
}

export interface PreparedInlineMessage {
  id: string;
  /** Unix seconds; the id is single-use and expires. */
  expiration_date: number;
}

/** Narrow view of Telegraf's client: callApi is typed `keyof Telegram`, which
 *  predates Bot API 8.0, so the untyped method name is cast here — once only. */
interface RawApiClient {
  callApi(method: string, payload: unknown): Promise<unknown>;
}

export async function savePreparedInlineMessage(
  params: SavePreparedInlineMessageParams
): Promise<PreparedInlineMessage> {
  const bot = getBotInstance();
  if (!bot) throw new TelegramApiUnavailableError();

  const client = bot.telegram as unknown as RawApiClient;
  const result = await client.callApi("savePreparedInlineMessage", params);

  const prepared = result as Partial<PreparedInlineMessage> | null;
  if (!prepared || typeof prepared.id !== "string") {
    log.error("savePreparedInlineMessage returned an unexpected payload: %j", result);
    throw new Error("Telegram вернул неожиданный ответ.");
  }

  return {
    id: prepared.id,
    expiration_date: typeof prepared.expiration_date === "number" ? prepared.expiration_date : 0,
  };
}

/** True for Telegram's "can't parse entities" family of 400s, where retrying the
 *  same call without parse_mode is the right move. */
export function isEntityParseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("can't parse entities") || msg.includes("can't find end") || msg.includes("entity");
}
