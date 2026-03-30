/**
 * Telegraf middleware: logs every incoming bot update to action_logs.
 * Provides a blanket audit trail for all Telegram interactions.
 */
import type { Context, MiddlewareFn } from "telegraf";
import { logAction } from "../logging/actionLogger.js";

export function botLoggerMiddleware(): MiddlewareFn<Context> {
  return (ctx, next) => {
    const telegramId = ctx.from?.id ?? null;

    let updateType = "unknown";
    const updateDetails: Record<string, unknown> = {};

    if (ctx.message) {
      if ("text" in ctx.message && ctx.message.text) {
        const text = ctx.message.text;
        if (text.startsWith("/")) {
          updateType = "command";
          updateDetails.command = text.split(" ")[0];
        } else {
          updateType = "text_message";
          updateDetails.textLength = text.length;
        }
      } else if ("voice" in ctx.message) {
        updateType = "voice_message";
        updateDetails.duration = ctx.message.voice?.duration;
      } else if ("photo" in ctx.message) {
        updateType = "photo_message";
      } else if ("document" in ctx.message) {
        updateType = "document_message";
        updateDetails.fileName = ctx.message.document?.file_name;
      } else if ("video_note" in ctx.message) {
        updateType = "video_note";
      } else if ("sticker" in ctx.message) {
        updateType = "sticker";
      }
    } else if (ctx.callbackQuery) {
      updateType = "callback_query";
      if ("data" in ctx.callbackQuery) {
        updateDetails.data = ctx.callbackQuery.data;
      }
    }

    logAction(null, telegramId, "bot_update", {
      type: updateType,
      ...updateDetails,
    });

    return next();
  };
}
