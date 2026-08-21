// Telegram side of the Claude Code bridge: forum topics as the session list,
// plain messages as the conversation, inline buttons as the permission prompt.
import { Markup } from "telegraf";
import { getBotInstance } from "../botInstance.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { getAccessByUser } from "../cc/accessRepository.js";
import {
  buildTopicKey,
  findTopicByKey,
  findTopicByThread,
  forgetTopic,
  forgetTopicByThread,
  getTopicState,
  listStaleOpenTopics,
  listTopics,
  setTopicClosed,
  saveTopic,
  touchTopic,
} from "../cc/repository.js";
import {
  countOnlineSessionsForThread,
  countSessionsForThread,
  pushEvent,
  rememberPermission,
  sessionsForThread,
  takePermissionOwner,
  unregisterSession,
} from "../cc/registry.js";
import type { CcSession } from "../cc/registry.js";
import type { CcPermissionRequest } from "../cc/types.js";

const log = createLogger("cc-bridge");

// Telegram hard-caps a message at 4096 characters; leave room for the prefix we
// add to every chunk so a long answer never fails to send.
const CHUNK_LIMIT = 3800;

/**
 * The bridge is per-user now: which group a message goes to comes from that
 * user's cc_access row, never from a process-wide setting. All the feature needs
 * globally is a database to read those rows from.
 */
export function isCcConfigured(): boolean {
  return isDatabaseAvailable();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function splitForTelegram(text: string): string[] {
  if (text.length <= CHUNK_LIMIT) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > CHUNK_LIMIT) {
    // Prefer a line break so code blocks and prose stay readable when split.
    const window = rest.slice(0, CHUNK_LIMIT);
    const cut = window.lastIndexOf("\n");
    const at = cut > CHUNK_LIMIT / 2 ? cut : CHUNK_LIMIT;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

// Two sessions starting at once in the same directory would otherwise both miss
// the lookup and each create a topic, orphaning one of them.
const topicInFlight = new Map<string, Promise<EnsuredTopic>>();

export interface EnsuredTopic {
  threadId: number;
  /** How long the topic sat unused before this session. Zero for a fresh one. */
  idleMs: number;
  reopened: boolean;
}

/**
 * Returns the forum topic for this machine+directory, creating it on first use.
 * A stored topic the user deleted manually is transparently recreated, and an
 * archived one is reopened.
 */
export async function ensureTopic(
  userId: number,
  chatId: number,
  machine: string,
  cwd: string,
  project: string,
  session: string,
): Promise<EnsuredTopic> {
  const topicKey = buildTopicKey(machine, cwd, session);
  // Keyed per owner too: two users may legitimately have the same machine+path.
  const inFlightKey = `${userId}:${topicKey}`;
  const pending = topicInFlight.get(inFlightKey);
  if (pending) return pending;

  const work = createOrFindTopic(userId, chatId, topicKey, machine, project, session).finally(() => {
    topicInFlight.delete(inFlightKey);
  });
  topicInFlight.set(inFlightKey, work);
  return work;
}

/** An archived topic is reopened by use, so the archive never gets in the way. */
async function reopenIfClosed(chatId: number, threadId: number): Promise<boolean> {
  const bot = getBotInstance();
  if (!bot) return false;
  try {
    await bot.telegram.reopenForumTopic(chatId, threadId);
  } catch (err) {
    // Already open is the common case and not worth a log line.
    const message = err instanceof Error ? err.message : String(err);
    if (!/not modified|TOPIC_NOT_MODIFIED/i.test(message)) {
      log.warn("reopenForumTopic %d failed: %s", threadId, message);
    }
  }
  await setTopicClosed(threadId, false).catch(() => {});
  return true;
}

async function createOrFindTopic(
  userId: number,
  chatId: number,
  topicKey: string,
  machine: string,
  project: string,
  session: string,
): Promise<EnsuredTopic> {
  const bot = getBotInstance();
  if (!bot) throw new Error("Bot instance is not ready");

  const existing = await findTopicByKey(userId, topicKey);
  if (existing) {
    // Read the state before touching it: afterwards the idle time is zero.
    const state = await getTopicState(existing.threadId);
    const reopened = state?.closed ? await reopenIfClosed(chatId, existing.threadId) : false;
    await touchTopic(existing.threadId);
    return { threadId: existing.threadId, idleMs: state?.idleMs ?? 0, reopened };
  }

  const name = `${machine} · ${project}${session ? ` · ${session}` : ""}`.slice(0, 128);
  const topic = await bot.telegram.createForumTopic(chatId, name);
  await saveTopic({ userId, topicKey, machine, project, threadId: topic.message_thread_id });
  log.info("created forum topic %d for %s", topic.message_thread_id, topicKey);
  return { threadId: topic.message_thread_id, idleMs: 0, reopened: false };
}

async function send(chatId: number, threadId: number, text: string, html = false): Promise<void> {
  const bot = getBotInstance();
  if (!bot) return;

  for (const chunk of splitForTelegram(text)) {
    try {
      await bot.telegram.sendMessage(chatId, chunk, {
        message_thread_id: threadId,
        ...(html ? { parse_mode: "HTML" as const } : {}),
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The user deleted the topic out from under us: drop the mapping so the
      // next session recreates it instead of failing forever.
      if (/thread not found|TOPIC_DELETED|message thread not found/i.test(message)) {
        const topic = await findTopicByThread(threadId).catch(() => null);
        if (topic) await forgetTopic(topic.topicKey).catch(() => {});
        log.warn("topic %d is gone, mapping dropped", threadId);
        return;
      }
      log.error("send to topic %d failed: %s", threadId, message);
      return;
    }
  }
}

// A machine re-registers whenever the hub forgets it — a restart, a dropped
// stream, a network blip — and every machine does it at once after a hub
// restart. Announcing each time turns the topic into a wall of identical
// "session started" lines that carry no new information, so collapse a burst
// into the first one.
const ANNOUNCE_DEBOUNCE_MS = 10 * 60_000;
const lastAnnouncedAt = new Map<number, number>();

// Below this the gap is unremarkable and saying it would be noise.
const IDLE_WORTH_MENTIONING_MS = 3 * 86_400_000;

export async function announceSession(
  session: CcSession,
  reconnect: boolean,
  idleMs = 0,
): Promise<void> {
  const now = Date.now();
  if (reconnect || now - (lastAnnouncedAt.get(session.threadId) ?? 0) < ANNOUNCE_DEBOUNCE_MS) {
    return;
  }
  lastAnnouncedAt.set(session.threadId, now);

  const branch = session.branch ? ` · ${session.branch}` : "";
  // Answers "is this topic still current?" without making the user go looking.
  const idle =
    idleMs >= IDLE_WORTH_MENTIONING_MS
      ? `\nПредыдущая сессия здесь была ${Math.floor(idleMs / 86_400_000)} дн. назад.`
      : "";
  await send(
    session.groupId,
    session.threadId,
    `▶︎ Сессия запущена — <code>${escapeHtml(session.hostname)}</code>${escapeHtml(branch)}\n` +
      `<code>${escapeHtml(session.cwd)}</code>${idle}`,
    true,
  );
}

/**
 * Two terminals in one directory share a topic, and only the newest one receives.
 * Silence would leave the older one apparently alive but unaddressable, so say
 * which session is listening and how to separate them.
 */
export async function announceSecondSession(session: CcSession): Promise<void> {
  const total = countSessionsForThread(session.threadId);
  await send(
    session.groupId,
    session.threadId,
    `⚠️ В этом топике теперь сессий: ${total}. Сообщения идут в <b>#${session.ordinal}</b> — самую свежую.\n` +
      "Чтобы развести их по разным топикам, запускай с именами: <code>ccx имя</code>",
    true,
  );
}

/** After one session leaves, whoever inherits the topic should be named out loud. */
export async function announceAddressingChange(threadId: number): Promise<void> {
  const remaining = sessionsForThread(threadId);
  if (remaining.length === 0) return;
  const now = remaining[remaining.length - 1];
  await send(now.groupId, threadId, `Сообщения снова идут в #${now.ordinal}.`);
}

export async function announceSessionEnd(session: CcSession): Promise<void> {
  // Clearing the mark keeps "ended" and "started" paired: the next start is a
  // genuinely new session and should announce immediately.
  const announced = lastAnnouncedAt.delete(session.threadId);
  if (!announced) return;
  await send(session.groupId, session.threadId, "⏹ Сессия завершена.");
}

export async function postReply(session: CcSession, text: string, tagged: boolean): Promise<void> {
  // Only tag when the topic holds more than one live session — otherwise the
  // prefix is noise on every single message.
  const prefix = tagged ? `[#${session.ordinal}] ` : "";
  await send(session.groupId, session.threadId, prefix + text);
}

export async function postPermission(session: CcSession, req: CcPermissionRequest): Promise<void> {
  const chatId = session.groupId;
  const bot = getBotInstance();
  if (!bot) return;

  rememberPermission(req.requestId, session.id);

  const preview = req.inputPreview.trim();
  const body =
    `⚠️ <b>${escapeHtml(req.toolName)}</b>\n` +
    `${escapeHtml(req.description)}\n` +
    (preview ? `<pre>${escapeHtml(preview.slice(0, 700))}</pre>` : "");

  try {
    await bot.telegram.sendMessage(chatId, body, {
      message_thread_id: session.threadId,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Разрешить", `cc:a:${req.requestId}`),
          Markup.button.callback("❌ Отклонить", `cc:d:${req.requestId}`),
        ],
      ]),
    });
  } catch (err) {
    log.error("permission prompt failed: %s", err instanceof Error ? err.message : String(err));
  }
}

// ─── Ending sessions and tidying topics ──────────────────────────────────────

function ageRu(from: Date): string {
  const days = Math.floor((Date.now() - from.getTime()) / 86_400_000);
  if (days >= 1) return `${days} дн. назад`;
  const hours = Math.floor((Date.now() - from.getTime()) / 3_600_000);
  if (hours >= 1) return `${hours} ч. назад`;
  return "только что";
}

/** The menu behind /end: what can be ended, and what can be tidied away. */
export async function postEndMenu(chatId: number, threadId: number): Promise<void> {
  const bot = getBotInstance();
  if (!bot) return;

  const live = sessionsForThread(threadId);
  const rows = live.slice(0, 3).map((s) => [
    Markup.button.callback(`⏹ Завершить #${s.ordinal}`, `cc:sd:${s.id}`),
    Markup.button.callback(`🔌 Отключить #${s.ordinal}`, `cc:dt:${s.id}`),
  ]);
  rows.push([
    Markup.button.callback("📁 Закрыть топик", "cc:tc"),
    Markup.button.callback("🗑 Удалить топик", "cc:td"),
  ]);

  const header = live.length
    ? `Живых сессий здесь: ${live.length}.\n` +
      "<b>Завершить</b> — закроет Claude Code на машине, как Ctrl+C. " +
      "<b>Отключить</b> — только отцепит мост, сессия останется работать в терминале."
    : "Живых сессий здесь нет.";

  await bot.telegram.sendMessage(chatId, header, {
    message_thread_id: threadId,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard(rows),
  });
}

/** Sends a control event and reports whether the session was still reachable. */
export function controlSession(sessionId: string, action: "detach" | "shutdown"): boolean {
  return pushEvent(sessionId, { type: "control", action });
}

export async function closeTopic(chatId: number, threadId: number): Promise<string> {
  const bot = getBotInstance();
  if (!bot) return "Мост не настроен";
  try {
    await bot.telegram.closeForumTopic(chatId, threadId);
    await setTopicClosed(threadId, true).catch(() => {});
    return "Топик закрыт";
  } catch (err) {
    log.error("closeForumTopic failed: %s", err instanceof Error ? err.message : String(err));
    return "Не удалось закрыть топик";
  }
}

/**
 * Deletes the topic and forgets the mapping. Live sessions are detached first:
 * left bridged they would recreate the topic on their next reconnect, and the
 * user would watch the thing they just deleted come back.
 */
export async function deleteTopic(chatId: number, threadId: number): Promise<string> {
  const bot = getBotInstance();
  if (!bot) return "Мост не настроен";

  for (const s of sessionsForThread(threadId)) {
    controlSession(s.id, "detach");
    unregisterSession(s.id);
  }
  await forgetTopicByThread(threadId).catch(() => {});

  try {
    await bot.telegram.deleteForumTopic(chatId, threadId);
    return "Топик удалён";
  } catch (err) {
    log.error("deleteForumTopic failed: %s", err instanceof Error ? err.message : String(err));
    return "Не удалось удалить топик";
  }
}

/** Offered right after a session ends, when the user still knows if they need the topic. */
export async function offerTopicCleanup(chatId: number, threadId: number): Promise<void> {
  const bot = getBotInstance();
  if (!bot) return;
  if (sessionsForThread(threadId).length > 0) return; // ещё есть живые — рано убирать

  await bot.telegram
    .sendMessage(chatId, "Убрать топик?", {
      message_thread_id: threadId,
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("📁 Закрыть", "cc:tc"),
          Markup.button.callback("🗑 Удалить", "cc:td"),
          Markup.button.callback("Оставить", "cc:x"),
        ],
      ]),
    })
    .catch(() => {});
}

/**
 * Closes topics idle longer than `days`, leaving a note about why and how to get
 * them back. Topics with a live session are left alone regardless of age: the
 * clock measures registrations, and a long-running session does not re-register.
 */
export async function archiveStaleTopics(days: number): Promise<number> {
  const bot = getBotInstance();
  if (!bot) return 0;

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const stale = await listStaleOpenTopics(cutoff);
  let closed = 0;
  // Each topic belongs to its owner's group; resolve once per user per run.
  const groups = new Map<number, number | null>();

  for (const topic of stale) {
    if (countSessionsForThread(topic.threadId) > 0) continue;

    if (!groups.has(topic.userId)) {
      const access = await getAccessByUser(topic.userId).catch(() => null);
      groups.set(topic.userId, access?.groupId ?? null);
    }
    const chatId = groups.get(topic.userId);
    if (chatId === null || chatId === undefined) continue;
    try {
      await bot.telegram.sendMessage(
        chatId,
        `📁 Топик закрыт — ${days} дн. без сессий. Он откроется сам, когда здесь снова запустят сессию.`,
        { message_thread_id: topic.threadId },
      );
      await bot.telegram.closeForumTopic(chatId, topic.threadId);
      await setTopicClosed(topic.threadId, true);
      closed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The user deleted it by hand — drop the mapping instead of retrying daily.
      if (/thread not found|TOPIC_DELETED|TOPIC_ID_INVALID|message thread not found/i.test(message)) {
        await forgetTopicByThread(topic.threadId).catch(() => {});
        log.info("topic %d is gone, mapping dropped during archive", topic.threadId);
        continue;
      }
      log.warn("archiving topic %d failed: %s", topic.threadId, message);
    }
  }
  return closed;
}

/** The bulk view: what has piled up, how stale it is, and a way to drop each one. */
export async function postTopicsList(chatId: number, threadId: number, userId: number): Promise<void> {
  const bot = getBotInstance();
  if (!bot) return;

  const topics = await listTopics(userId);
  if (topics.length === 0) {
    await bot.telegram.sendMessage(chatId, "Топиков пока нет.", { message_thread_id: threadId });
    return;
  }

  const lines = topics.map((t) => {
    const live = countSessionsForThread(t.threadId);
    const mark = live > 0 ? "🟢" : t.closedAt ? "📁" : "⚪️";
    return `${mark} <b>${escapeHtml(t.machine)} · ${escapeHtml(t.project)}</b> — ${ageRu(t.lastUsedAt)}`;
  });

  // One button per topic, two per row: enough to act on without leaving the list.
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < topics.length; i += 2) {
    rows.push(
      topics.slice(i, i + 2).map((t) =>
        Markup.button.callback(`🗑 ${t.machine} · ${t.project}`.slice(0, 40), `cc:tk:${t.threadId}`),
      ),
    );
  }

  await bot.telegram.sendMessage(chatId, lines.join("\n"), {
    message_thread_id: threadId,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard(rows),
  });
}

/**
 * Resolves a Telegram file_id to a live download and returns the upstream body.
 * Resolution happens here, at redeem time, because the link Telegram hands back
 * embeds the bot token and expires about an hour after it is issued.
 */
export async function openTelegramFile(fileId: string): Promise<Buffer> {
  const bot = getBotInstance();
  if (!bot) throw new Error("Bot instance is not ready");
  const link = await bot.telegram.getFileLink(fileId);
  const upstream = await telegramFetch(link.toString());
  if (!upstream.ok) throw new Error(`Telegram download failed: HTTP ${upstream.status}`);
  return Buffer.from(await upstream.arrayBuffer());
}

/**
 * Applies a button press. Returns the label to show in the answerCbQuery toast,
 * or null when the request is unknown — an old button, or one the terminal
 * already answered.
 */
export function resolvePermission(requestId: string, behavior: "allow" | "deny"): string | null {
  const sessionId = takePermissionOwner(requestId);
  if (!sessionId) return null;
  const delivered = pushEvent(sessionId, { type: "verdict", requestId, behavior });
  if (!delivered) return null;
  return behavior === "allow" ? "Разрешено" : "Отклонено";
}
