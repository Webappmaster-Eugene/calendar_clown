// Bot-side entry point of the Claude Code bridge.
//
// Everything posted in the bridge supergroup belongs to the bridge, so this
// middleware short-circuits before the normal command handlers: the group is not
// a place where /expenses or /today should mean anything.
import { Markup, type Context, type MiddlewareFn } from "telegraf";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { transcribeVoice } from "../voice/transcribe.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { createLogger } from "../utils/logger.js";
import {
  announceAddressingChange,
  ccGroupId,
  closeTopic,
  controlSession,
  deleteTopic,
  offerTopicCleanup,
  postEndMenu,
  postTopicsList,
  resolvePermission,
} from "../services/ccBridgeService.js";
import {
  getSession,
  isSessionOnline,
  newestSessionForThread,
  pushEvent,
  rememberFile,
  unregisterSession,
} from "../cc/registry.js";

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

  await acknowledge(ctx, threadId, session.id, "Сообщение");
}

/**
 * A queued event is not a delivered one. When the machine has no stream attached
 * — asleep, terminal closed, network gone — the tick would be a lie, so say what
 * actually happened instead.
 */
async function acknowledge(ctx: Context, threadId: number, sessionId: string, what: string): Promise<void> {
  if (isSessionOnline(sessionId)) {
    // A tick beats silence: an event lands in the session's queue and may wait
    // there until Claude finishes what it is doing, which looks like nothing
    // happened.
    await ctx.react?.("👌").catch(() => {});
    return;
  }
  await ctx.reply(
    `Машина сейчас офлайн — спит или сессия закрыта. ${what} доставлю, когда она вернётся; ` +
      "если не вернётся за полчаса, пропадёт. Тогда запусти сессию заново.",
    { message_thread_id: threadId },
  );
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

// Telegram's own ceiling for getFile; a larger file cannot be downloaded by a
// bot at all, so reject it here instead of failing later in the hub.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface Attachment {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}

function captionOf(message: object): string {
  return "caption" in message && typeof message.caption === "string" ? message.caption.trim() : "";
}

function extractAttachment(message: object): Attachment | null {
  if ("photo" in message && Array.isArray(message.photo) && message.photo.length > 0) {
    // Telegram lists sizes ascending; the last one is the original.
    const best = message.photo[message.photo.length - 1] as {
      file_id: string;
      file_unique_id: string;
      file_size?: number;
    };
    return {
      fileId: best.file_id,
      name: `photo_${best.file_unique_id}.jpg`,
      mime: "image/jpeg",
      size: best.file_size ?? 0,
    };
  }

  for (const kind of ["document", "video", "audio", "video_note"] as const) {
    if (!(kind in message)) continue;
    const file = (message as Record<string, unknown>)[kind] as
      | { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number }
      | undefined;
    if (!file?.file_id) continue;
    return {
      fileId: file.file_id,
      name: file.file_name ?? `${kind}_${file.file_unique_id}`,
      mime: file.mime_type ?? "application/octet-stream",
      size: file.file_size ?? 0,
    };
  }

  return null;
}

async function forwardAttachment(
  ctx: Context,
  threadId: number,
  attachment: Attachment,
  caption: string,
): Promise<void> {
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    await ctx.reply("Файл больше 20 МБ — Telegram не отдаёт такие ботам.", {
      message_thread_id: threadId,
    });
    return;
  }

  const session = newestSessionForThread(threadId);
  if (!session) {
    await ctx.reply("Нет живой сессии в этом топике. Запусти ccx на машине.", {
      message_thread_id: threadId,
    });
    return;
  }

  const key = rememberFile({
    sessionId: session.id,
    fileId: attachment.fileId,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
  });

  const delivered = pushEvent(session.id, {
    type: "file",
    key,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    caption,
  });

  if (!delivered) {
    await ctx.reply("Сессия отвалилась, файл не доставлен.", { message_thread_id: threadId });
    return;
  }

  await acknowledge(ctx, threadId, session.id, "Файл");
}

/** Replaces a message's buttons with a yes/no pair, so destructive acts take two taps. */
async function askConfirm(ctx: Context, question: string, yesData: string): Promise<void> {
  await ctx
    .editMessageText(question, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Да", yesData), Markup.button.callback("Отмена", "cc:x")],
      ]),
    })
    .catch(() => {});
}

async function handleCallback(ctx: Context, data: string, threadId: number | undefined): Promise<void> {
  const answer = (text?: string): Promise<unknown> => ctx.answerCbQuery(text).catch(() => {});
  const clearButtons = (): Promise<unknown> => ctx.editMessageReplyMarkup(undefined).catch(() => {});

  const permission = data.match(/^cc:(a|d):(.+)$/);
  if (permission) {
    const behavior = permission[1] === "a" ? "allow" : "deny";
    const label = resolvePermission(permission[2], behavior);
    await answer(label ?? "Запрос уже неактуален");
    // Strip the buttons so a stale prompt cannot be pressed twice.
    await clearButtons();
    return;
  }

  const session = data.match(/^cc:(sd|sdy|dt):([0-9a-f]+)$/);
  if (session) {
    const [, action, sessionId] = session;
    const live = getSession(sessionId);
    if (!live) {
      await answer("Сессия уже завершилась");
      await clearButtons();
      return;
    }

    if (action === "sd") {
      await answer();
      await askConfirm(
        ctx,
        `Завершить сессию #${live.ordinal}? Это как Ctrl+C: если Claude сейчас правит файл, ` +
          "правка может остаться наполовину применённой.",
        `cc:sdy:${sessionId}`,
      );
      return;
    }

    const mode = action === "sdy" ? "shutdown" : "detach";
    const reached = controlSession(sessionId, mode);
    if (mode === "shutdown") {
      // Drop it here rather than waiting for the client's /cc/bye: the topic
      // should stop offering a session that is on its way out.
      unregisterSession(sessionId);
    }
    await answer(reached ? "Готово" : "Машина офлайн, команда не дошла");
    await ctx
      .editMessageText(
        reached
          ? mode === "shutdown"
            ? `⏹ Сессия #${live.ordinal} завершена.`
            : `🔌 Мост для сессии #${live.ordinal} отключён, Claude Code продолжает работать в терминале.`
          : "Машина офлайн — команда не доставлена.",
      )
      .catch(() => {});

    if (reached && mode === "shutdown" && threadId !== undefined) {
      await announceAddressingChange(threadId).catch(() => {});
      await offerTopicCleanup(threadId);
    }
    return;
  }

  const listed = data.match(/^cc:(tk|tky):(-?\d+)$/);
  if (listed) {
    const target = Number(listed[2]);
    if (listed[1] === "tk") {
      await answer();
      await askConfirm(ctx, "Удалить этот топик вместе со всей перепиской? Это необратимо.", `cc:tky:${target}`);
      return;
    }
    const result = await deleteTopic(target);
    await answer(result);
    // The list lives in another topic, so it survives; just retire its buttons.
    await clearButtons();
    return;
  }

  switch (data) {
    case "cc:tc": {
      if (threadId === undefined) return void (await answer());
      await clearButtons();
      await answer(await closeTopic(threadId));
      return;
    }
    case "cc:td": {
      await answer();
      await askConfirm(ctx, "Удалить топик вместе со всей перепиской? Это необратимо.", "cc:tdy");
      return;
    }
    case "cc:tdy": {
      if (threadId === undefined) return void (await answer());
      await answer("Удаляю…");
      await deleteTopic(threadId);
      return;
    }
    case "cc:x":
      await answer();
      await ctx.deleteMessage().catch(() => clearButtons());
      return;
    default:
      await answer();
  }
}

const HELP = [
  "<b>Мост Claude Code</b>",
  "",
  "Пишите в топик текстом или голосом — уйдёт в сессию. Файлы и фото тоже.",
  "",
  "<code>/end</code> — завершить сессию или убрать топик",
  "<code>/topics</code> — все топики с возрастом и кнопкой удаления",
  "<code>/help</code> — эта справка",
  "",
  "На машине: <code>ccx имя</code> — сессия со своим топиком, <code>ccx имя --resume</code> — вернуться в неё.",
].join("\n");

/** Returns true when the text was a bridge command and has been handled. */
async function handleCommand(ctx: Context, threadId: number, text: string): Promise<boolean> {
  // In groups Telegram appends the bot username: /end@sovetnik_bot
  const command = text.trim().split(/\s+/)[0].replace(/@\S+$/, "").toLowerCase();
  switch (command) {
    case "/end":
      await postEndMenu(threadId);
      return true;
    case "/topics":
      await postTopicsList(threadId);
      return true;
    case "/help":
      await ctx.reply(HELP, { message_thread_id: threadId, parse_mode: "HTML" });
      return true;
    default:
      return false;
  }
}

export function ccBridgeMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const groupId = ccGroupId();
    if (groupId === null || ctx.chat?.id !== groupId) return next();

    // The bot's own service messages ("topic created") come back as updates.
    // Dropping them silently keeps the warning below meaning what it says.
    if (ctx.from?.id === ctx.botInfo?.id) return;

    if (!isTrustedSender(ctx)) {
      log.warn("dropped update from untrusted sender %s in bridge group", ctx.from?.id ?? "?");
      return;
    }

    const callbackData =
      ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : null;
    if (callbackData) {
      const from = ctx.callbackQuery?.message;
      const inThread =
        from && "message_thread_id" in from && typeof from.message_thread_id === "number"
          ? from.message_thread_id
          : undefined;
      await handleCallback(ctx, callbackData, inThread);
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
      if (await handleCommand(ctx, threadId, text)) return;
      await forwardToSession(ctx, threadId, text);
      return;
    }

    const attachment = extractAttachment(message);
    if (attachment) {
      await forwardAttachment(ctx, threadId, attachment, captionOf(message));
      return;
    }

    // Stickers, polls, locations and the rest have no useful mapping into a
    // coding session: say so rather than silently swallowing them.
    await ctx.reply("Мост принимает текст, голосовые, фото и файлы.", {
      message_thread_id: threadId,
    });
  };
}
