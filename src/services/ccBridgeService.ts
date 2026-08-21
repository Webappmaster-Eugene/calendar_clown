// Telegram side of the Claude Code bridge: forum topics as the session list,
// plain messages as the conversation, inline buttons as the permission prompt.
import { Markup } from "telegraf";
import { getBotInstance } from "../botInstance.js";
import { telegramFetch } from "../utils/proxyAgent.js";
import { createLogger } from "../utils/logger.js";
import {
  buildTopicKey,
  findTopicByKey,
  findTopicByThread,
  forgetTopic,
  forgetTopicByThread,
  listTopics,
  saveTopic,
  touchTopic,
} from "../cc/repository.js";
import {
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

export function ccGroupId(): number | null {
  const raw = process.env.CC_GROUP_ID?.trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function isCcConfigured(): boolean {
  return ccGroupId() !== null && Boolean(process.env.CC_MACHINE_TOKEN?.trim());
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
const topicInFlight = new Map<string, Promise<number>>();

/**
 * Returns the forum topic for this machine+directory, creating it on first use.
 * A stored topic the user deleted manually is transparently recreated.
 */
export async function ensureTopic(
  machine: string,
  cwd: string,
  project: string,
  session: string,
): Promise<number> {
  const topicKey = buildTopicKey(machine, cwd, session);
  const pending = topicInFlight.get(topicKey);
  if (pending) return pending;

  const work = createOrFindTopic(topicKey, machine, project, session).finally(() => {
    topicInFlight.delete(topicKey);
  });
  topicInFlight.set(topicKey, work);
  return work;
}

async function createOrFindTopic(
  topicKey: string,
  machine: string,
  project: string,
  session: string,
): Promise<number> {
  const chatId = ccGroupId();
  if (chatId === null) throw new Error("CC_GROUP_ID is not configured");
  const bot = getBotInstance();
  if (!bot) throw new Error("Bot instance is not ready");

  const existing = await findTopicByKey(topicKey);
  if (existing) {
    await touchTopic(existing.threadId);
    return existing.threadId;
  }

  const name = `${machine} · ${project}${session ? ` · ${session}` : ""}`.slice(0, 128);
  const topic = await bot.telegram.createForumTopic(chatId, name);
  await saveTopic({ topicKey, machine, project, threadId: topic.message_thread_id });
  log.info("created forum topic %d for %s", topic.message_thread_id, topicKey);
  return topic.message_thread_id;
}

async function send(threadId: number, text: string, html = false): Promise<void> {
  const chatId = ccGroupId();
  if (chatId === null) return;
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

export async function announceSession(session: CcSession, reconnect: boolean): Promise<void> {
  const now = Date.now();
  if (reconnect || now - (lastAnnouncedAt.get(session.threadId) ?? 0) < ANNOUNCE_DEBOUNCE_MS) {
    return;
  }
  lastAnnouncedAt.set(session.threadId, now);

  const branch = session.branch ? ` · ${session.branch}` : "";
  await send(
    session.threadId,
    `▶︎ Сессия запущена — <code>${escapeHtml(session.hostname)}</code>${escapeHtml(branch)}\n` +
      `<code>${escapeHtml(session.cwd)}</code>`,
    true,
  );
}

export async function announceSessionEnd(session: CcSession): Promise<void> {
  // Clearing the mark keeps "ended" and "started" paired: the next start is a
  // genuinely new session and should announce immediately.
  const announced = lastAnnouncedAt.delete(session.threadId);
  if (!announced) return;
  await send(session.threadId, "⏹ Сессия завершена.");
}

export async function postReply(session: CcSession, text: string, tagged: boolean): Promise<void> {
  // Only tag when the topic holds more than one live session — otherwise the
  // prefix is noise on every single message.
  const prefix = tagged ? `[#${session.ordinal}] ` : "";
  await send(session.threadId, prefix + text);
}

export async function postPermission(session: CcSession, req: CcPermissionRequest): Promise<void> {
  const chatId = ccGroupId();
  const bot = getBotInstance();
  if (chatId === null || !bot) return;

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
export async function postEndMenu(threadId: number): Promise<void> {
  const chatId = ccGroupId();
  const bot = getBotInstance();
  if (chatId === null || !bot) return;

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

export async function closeTopic(threadId: number): Promise<string> {
  const chatId = ccGroupId();
  const bot = getBotInstance();
  if (chatId === null || !bot) return "Мост не настроен";
  try {
    await bot.telegram.closeForumTopic(chatId, threadId);
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
export async function deleteTopic(threadId: number): Promise<string> {
  const chatId = ccGroupId();
  const bot = getBotInstance();
  if (chatId === null || !bot) return "Мост не настроен";

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
export async function offerTopicCleanup(threadId: number): Promise<void> {
  const chatId = ccGroupId();
  const bot = getBotInstance();
  if (chatId === null || !bot) return;
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

/** The bulk view: what has piled up, how stale it is, and a way to drop each one. */
export async function postTopicsList(threadId: number): Promise<void> {
  const chatId = ccGroupId();
  const bot = getBotInstance();
  if (chatId === null || !bot) return;

  const topics = await listTopics();
  if (topics.length === 0) {
    await bot.telegram.sendMessage(chatId, "Топиков пока нет.", { message_thread_id: threadId });
    return;
  }

  const lines = topics.map((t) => {
    const live = countSessionsForThread(t.threadId);
    const mark = live > 0 ? "🟢" : "⚪️";
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
