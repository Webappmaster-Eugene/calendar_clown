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
import { isDatabaseAvailable } from "../db/connection.js";
import {
  addCollaborator,
  bindGroup,
  findUserIdByTelegramId,
  getAccessByGroup,
  getAccessByUser,
  isCollaborator,
  issueMachineToken,
  listCollaborators,
  listMachineTokens,
  removeCollaborator,
  revokeMachineToken,
  type CcAccessRow,
} from "../cc/accessRepository.js";
import { createLogger } from "../utils/logger.js";
import {
  announceAddressingChange,
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

// A supergroup sees traffic on every message; resolving its owner from the
// database each time would be a query per update.
const ACCESS_TTL_MS = 60_000;
const accessCache = new Map<number, { access: CcAccessRow | null; at: number }>();

async function resolveGroupOwner(chatId: number): Promise<CcAccessRow | null> {
  const cached = accessCache.get(chatId);
  if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached.access;
  const access = await getAccessByGroup(chatId).catch(() => null);
  accessCache.set(chatId, { access, at: Date.now() });
  return access;
}

/** Drops the cached row so a fresh binding or revocation takes effect at once. */
export function forgetGroupAccess(chatId: number): void {
  accessCache.delete(chatId);
}

/**
 * Being in the group means seeing the conversation. Driving a session — and
 * approving a Bash call — takes ownership or an explicit collaborator entry, so
 * the gate is by sender identity, never by chat membership.
 */
async function mayDrive(access: CcAccessRow, telegramId: number): Promise<boolean> {
  const senderUserId = await findUserIdByTelegramId(telegramId).catch(() => null);
  if (senderUserId !== null && senderUserId === access.userId) return true;
  return isCollaborator(access.userId, telegramId).catch(() => false);
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

async function handleCallback(
  ctx: Context,
  data: string,
  chatId: number,
  threadId: number | undefined,
  userId: number,
): Promise<void> {
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
      await offerTopicCleanup(chatId, threadId);
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
    const result = await deleteTopic(chatId, target);
    await answer(result);
    // The list lives in another topic, so it survives; just retire its buttons.
    await clearButtons();
    return;
  }

  switch (data) {
    case "cc:tc": {
      if (threadId === undefined) return void (await answer());
      await clearButtons();
      await answer(await closeTopic(chatId, threadId));
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
      await deleteTopic(chatId, threadId);
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

/**
 * Binds an unbound supergroup to whoever runs it. This is the one command that
 * must work before the group is known, so it is handled ahead of the owner
 * lookup — everything else in an unbound group is none of the bridge's business.
 */
async function handleBind(ctx: Context, chatId: number): Promise<void> {
  const sender = ctx.from?.id;
  if (sender === undefined) return;

  const userId = await findUserIdByTelegramId(sender).catch(() => null);
  const access = userId === null ? null : await getAccessByUser(userId).catch(() => null);
  if (!userId || !access || access.status !== "active") {
    await ctx.reply("У вас нет доступа к мосту. Попросите администратора выдать его.");
    return;
  }
  if (access.groupId !== null && access.groupId !== chatId) {
    await ctx.reply("У вас уже привязана другая группа. Отвяжите её там командой /code unbind.");
    return;
  }
  if (!("is_forum" in ctx.chat! && ctx.chat.is_forum)) {
    await ctx.reply("В группе не включены темы. Настройки → Темы, затем повторите /code bind.");
    return;
  }

  const me = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id).catch(() => null);
  const canManage =
    me?.status === "administrator" && "can_manage_topics" in me && me.can_manage_topics === true;
  if (!canManage) {
    await ctx.reply(
      "Бот должен быть администратором с правом «Управление темами». Выдайте право и повторите /code bind.",
    );
    return;
  }

  await bindGroup(userId, chatId);
  forgetGroupAccess(chatId);
  await ctx.reply(
    "Группа привязана. Теперь получите токен машины: <code>/code token имя-машины</code> — " +
      "он придёт в личку.\n\n" +
      "⚠️ Кто угодно, кого вы добавите сюда и впустите через <code>/code allow</code>, " +
      "сможет запускать команды на ваших машинах и одобрять <code>Bash</code>. " +
      "Само по себе присутствие в группе такого права не даёт.",
    { parse_mode: "HTML" },
  );
}

/** `/code …` — machines, tokens and collaborators. Secrets go to DM, never here. */
async function handleCode(
  ctx: Context,
  chatId: number,
  threadId: number,
  access: CcAccessRow,
  args: string[],
): Promise<void> {
  const reply = (text: string): Promise<unknown> =>
    ctx.reply(text, { message_thread_id: threadId, parse_mode: "HTML" });
  const [sub, ...rest] = args;

  switch (sub) {
    case "token": {
      const label = rest.join(" ").trim() || "machine";
      const machines = await listMachineTokens(access.userId);
      if (machines.length >= access.maxMachines) {
        await reply(`Лимит машин исчерпан (${access.maxMachines}). Отзовите ненужную: /code machines`);
        return;
      }
      const token = await issueMachineToken(access.userId, label);
      const sender = ctx.from?.id;
      try {
        // Never into the group: a token is the ability to run commands on the
        // machine, and a group chat is the wrong place to keep one.
        await ctx.telegram.sendMessage(
          sender!,
          `Токен для машины «${label}» — показывается один раз:\n\n<code>${token}</code>\n\n` +
            "Он равносилен SSH-ключу: даёт возможность выполнять команды на этой машине. " +
            "Установка:\n<code>CC_HUB_URL=… CC_MACHINE_TOKEN=… CC_MACHINE=" +
            `${label} ./install.sh</code>`,
          { parse_mode: "HTML" },
        );
        await reply("Токен отправлен вам в личку.");
      } catch {
        await reply("Не удалось написать вам в личку — откройте диалог с ботом и повторите.");
      }
      return;
    }
    case "machines": {
      const machines = await listMachineTokens(access.userId);
      if (machines.length === 0) {
        await reply("Машин пока нет. Выдать токен: <code>/code token имя</code>");
        return;
      }
      const lines = machines.map(
        (m) =>
          `#${m.id} <b>${m.label}</b> — ${m.lastUsedAt ? `была ${ageRuShort(m.lastUsedAt)}` : "ещё не подключалась"}`,
      );
      await reply(`${lines.join("\n")}\n\nОтозвать: <code>/code revoke НОМЕР</code>`);
      return;
    }
    case "revoke": {
      const id = Number(rest[0]);
      if (!Number.isFinite(id)) {
        await reply("Укажите номер машины: <code>/code revoke 3</code>");
        return;
      }
      const done = await revokeMachineToken(access.userId, id);
      await reply(done ? `Машина #${id} отозвана.` : `Машина #${id} не найдена.`);
      return;
    }
    case "allow": {
      const id = Number(rest[0]);
      if (!Number.isFinite(id)) {
        await reply("Укажите Telegram ID: <code>/code allow 123456789</code>");
        return;
      }
      await addCollaborator(access.userId, id);
      await reply(
        `Пользователь <code>${id}</code> допущен.\n\n⚠️ Он теперь может вести ваши сессии и ` +
          "одобрять запуск команд на ваших машинах — это не «доступ на посмотреть».",
      );
      return;
    }
    case "deny": {
      const id = Number(rest[0]);
      if (!Number.isFinite(id)) {
        await reply("Укажите Telegram ID: <code>/code deny 123456789</code>");
        return;
      }
      const done = await removeCollaborator(access.userId, id);
      await reply(done ? `Пользователь <code>${id}</code> больше не допущен.` : "Такого в списке нет.");
      return;
    }
    case "who": {
      const ids = await listCollaborators(access.userId);
      await reply(
        ids.length === 0
          ? "Соавторов нет — сессии ведёте только вы."
          : `Соавторы: ${ids.map((i) => `<code>${i}</code>`).join(", ")}`,
      );
      return;
    }
    case "bind":
      await reply("Эта группа уже привязана к вам.");
      return;
    default:
      await reply(
        [
          "<code>/code token имя</code> — токен новой машины (придёт в личку)",
          "<code>/code machines</code> — список машин, <code>/code revoke N</code> — отозвать",
          "<code>/code allow ID</code> / <code>deny ID</code> / <code>who</code> — соавторы",
        ].join("\n"),
      );
  }
}

function ageRuShort(from: Date): string {
  const days = Math.floor((Date.now() - from.getTime()) / 86_400_000);
  if (days >= 1) return `${days} дн. назад`;
  const hours = Math.floor((Date.now() - from.getTime()) / 3_600_000);
  return hours >= 1 ? `${hours} ч. назад` : "только что";
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
async function handleCommand(
  ctx: Context,
  chatId: number,
  threadId: number,
  text: string,
  access: CcAccessRow,
): Promise<boolean> {
  // In groups Telegram appends the bot username: /end@sovetnik_bot
  const parts = text.trim().split(/\s+/);
  const command = parts[0].replace(/@\S+$/, "").toLowerCase();
  switch (command) {
    case "/code":
      await handleCode(ctx, chatId, threadId, access, parts.slice(1));
      return true;
    case "/end":
      await postEndMenu(chatId, threadId);
      return true;
    case "/topics":
      await postTopicsList(chatId, threadId, access.userId);
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
    // Private chats are the bot's normal home; only supergroups can be bridges,
    // so nothing else pays for the lookup.
    if (ctx.chat?.type !== "supergroup" || !isDatabaseAvailable()) return next();

    const chatId = ctx.chat.id;
    const access = await resolveGroupOwner(chatId);
    if (!access) {
      // The only command that can be meaningful before the group has an owner.
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      if (/^\/code(@\S+)?\s+bind\b/i.test(text.trim())) {
        await handleBind(ctx, chatId);
        return;
      }
      return next(); // не мостовая группа — обычная логика бота
    }
    if (access.status !== "active") return;

    // The bot's own service messages ("topic created") come back as updates.
    // Dropping them silently keeps the warning below meaning what it says.
    if (ctx.from?.id === ctx.botInfo?.id) return;

    const sender = ctx.from?.id;
    if (sender === undefined || !(await mayDrive(access, sender))) {
      log.warn("dropped update from %s in bridge group %d", sender ?? "?", chatId);
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
      await handleCallback(ctx, callbackData, chatId, inThread, access.userId);
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
      if (await handleCommand(ctx, chatId, threadId, text, access)) return;
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
