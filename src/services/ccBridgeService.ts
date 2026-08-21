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
  saveTopic,
  touchTopic,
} from "../cc/repository.js";
import { pushEvent, rememberPermission, takePermissionOwner } from "../cc/registry.js";
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
  const prefix = tagged ? `[${session.id.slice(0, 4)}] ` : "";
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
