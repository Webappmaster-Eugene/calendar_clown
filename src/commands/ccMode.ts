// Bot-side entry point of the Claude Code bridge.
//
// Everything posted in the bridge supergroup belongs to the bridge, so this
// middleware short-circuits before the normal command handlers: the group is not
// a place where /expenses or /today should mean anything.
import type { Context, MiddlewareFn } from "telegraf";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { transcribeVoice } from "../voice/transcribe.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { createLogger } from "../utils/logger.js";
import { ccGroupId, resolvePermission } from "../services/ccBridgeService.js";
import { newestSessionForThread, pushEvent } from "../cc/registry.js";

const log = createLogger("cc-mode");

const VOICE_DIR = join("data", "voice");

/**
 * Only the bootstrap admin may drive sessions. Anyone who can post here can make
 * Claude run tools on three machines, so this gate is by sender identity — never
 * by chat membership, which the supergroup alone would imply.
 */
function isTrustedSender(ctx: Context): boolean {
  const from = ctx.from?.id;
  return from !== undefined && isBootstrapAdmin(from);
}

async function forwardToSession(ctx: Context, threadId: number, text: string): Promise<void> {
  const session = newestSessionForThread(threadId);
  if (!session) {
    await ctx.reply("Нет живой сессии в этом топике. Запусти ccx на машине.", {
      message_thread_id: threadId,
    });
    return;
  }

  const delivered = pushEvent(session.id, {
    type: "message",
    content: text,
    meta: {
      user_id: String(ctx.from?.id ?? ""),
      thread_id: String(threadId),
      ts: new Date().toISOString(),
    },
  });

  if (!delivered) {
    await ctx.reply("Сессия отвалилась, сообщение не доставлено.", { message_thread_id: threadId });
    return;
  }

  // A tick beats silence: an event lands in the session's queue and may wait
  // there until Claude finishes what it is doing, which looks like nothing
  // happened.
  await ctx.react?.("👌").catch(() => {});
}

async function handleVoice(ctx: Context, threadId: number, fileId: string, duration: number): Promise<void> {
  let filePath: string | null = null;
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await telegramFetch(link.toString());
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    await mkdir(VOICE_DIR, { recursive: true });
    filePath = join(VOICE_DIR, `cc_${fileId.slice(-16)}.ogg`);
    await writeFile(filePath, Buffer.from(await res.arrayBuffer()));

    // "general" — this is dictation of a coding task, not a calendar phrase.
    const transcript = await transcribeVoice(filePath, "general", duration);
    if (!transcript || !transcript.trim()) {
      await ctx.reply("Не разобрал голосовое.", { message_thread_id: threadId });
      return;
    }

    // Echo the transcript: STT does mangle terms, and the user needs to see what
    // was actually sent before Claude acts on it.
    await ctx.reply(`🎙 ${transcript.trim()}`, { message_thread_id: threadId });
    await forwardToSession(ctx, threadId, transcript.trim());
  } catch (err) {
    log.error("voice failed: %s", err instanceof Error ? err.message : String(err));
    await ctx.reply("Ошибка распознавания голосового.", { message_thread_id: threadId }).catch(() => {});
  } finally {
    if (filePath) await unlink(filePath).catch(() => {});
  }
}

async function handleCallback(ctx: Context, data: string): Promise<void> {
  const match = data.match(/^cc:(a|d):(.+)$/);
  if (!match) {
    await ctx.answerCbQuery().catch(() => {});
    return;
  }

  const behavior = match[1] === "a" ? "allow" : "deny";
  const label = resolvePermission(match[2], behavior);
  await ctx.answerCbQuery(label ?? "Запрос уже неактуален").catch(() => {});

  // Strip the buttons so a stale prompt cannot be pressed twice.
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
}

export function ccBridgeMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const groupId = ccGroupId();
    if (groupId === null || ctx.chat?.id !== groupId) return next();

    if (!isTrustedSender(ctx)) {
      log.warn("dropped update from untrusted sender %s in bridge group", ctx.from?.id ?? "?");
      return;
    }

    const callbackData =
      ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : null;
    if (callbackData) {
      await handleCallback(ctx, callbackData);
      return;
    }

    const message = ctx.message;
    if (!message) return;

    // Forum service messages (topic created/edited) carry no thread of our own.
    const threadId = "message_thread_id" in message ? message.message_thread_id : undefined;
    if (threadId === undefined) return;

    if ("voice" in message && message.voice) {
      await handleVoice(ctx, threadId, message.voice.file_id, message.voice.duration);
      return;
    }

    if ("text" in message && message.text) {
      const text = message.text.trim();
      if (!text) return;
      await forwardToSession(ctx, threadId, text);
      return;
    }

    // Photos, documents and the rest are out of scope for the narrow bridge:
    // say so rather than silently swallowing them.
    await ctx.reply("Мост принимает только текст и голосовые.", { message_thread_id: threadId });
  };
}
