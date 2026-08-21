// In-memory registry of live Claude Code sessions and their SSE writers.
//
// Deliberately not persisted: a session only exists while its `claude` process
// runs, so a hub restart legitimately drops everything — the machines reconnect
// and re-register. Only the topic mapping is durable (see cc/repository.ts).
import type http from "http";
import { randomBytes } from "crypto";
import { createLogger } from "../utils/logger.js";
import type { CcEvent, CcSessionInfo } from "./types.js";

const log = createLogger("cc");

// A session that never attaches its stream would otherwise pin memory forever.
const QUEUE_MAX = 50;
// Permission requests are answered in seconds; anything older is a stale button
// press on a message the user scrolled back to.
const PERMISSION_TTL_MS = 30 * 60_000;

interface Session {
  id: string;
  sessionToken: string;
  machine: string;
  hostname: string;
  cwd: string;
  project: string;
  branch: string | null;
  threadId: number;
  /** Position within the topic, so buttons and tags can say "#2" instead of a hash. */
  ordinal: number;
  res: http.ServerResponse | null;
  /** Events produced between register and the stream attaching. */
  queue: CcEvent[];
  startedAt: number;
  lastSeenAt: number;
}

const sessions = new Map<string, Session>();
const permissionOwners = new Map<string, { sessionId: string; at: number }>();

function newId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function registerSession(input: {
  machine: string;
  hostname: string;
  cwd: string;
  project: string;
  branch: string | null;
  threadId: number;
}): { sessionId: string; sessionToken: string } {
  const id = newId(8);
  const sessionToken = newId(24);
  const now = Date.now();
  // Numbering restarts once a topic empties: "#1" should mean the only session
  // there, not the seventh one this month.
  let ordinal = 1;
  for (const s of sessions.values()) {
    if (s.threadId === input.threadId && s.ordinal >= ordinal) ordinal = s.ordinal + 1;
  }
  sessions.set(id, {
    id,
    sessionToken,
    ...input,
    ordinal,
    res: null,
    queue: [],
    startedAt: now,
    lastSeenAt: now,
  });
  log.info("session registered: %s (%s · %s)", id, input.machine, input.project);
  return { sessionId: id, sessionToken };
}

/** Constant work is not needed here: ids are unguessable, the token compare is the gate. */
export function authorize(sessionId: string, token: string): Session | null {
  const s = sessions.get(sessionId);
  if (!s || s.sessionToken !== token) return null;
  s.lastSeenAt = Date.now();
  return s;
}

export function attachStream(session: Session, res: http.ServerResponse): void {
  // A second stream for the same session means the old one is dead or a dup;
  // the newest wins so a reconnect after a network drop takes over cleanly.
  if (session.res && session.res !== res) {
    try {
      session.res.end();
    } catch {
      // already torn down
    }
  }
  session.res = res;
  const queued = session.queue.splice(0);
  for (const event of queued) writeEvent(res, event);
}

export function detachStream(session: Session, res: http.ServerResponse): void {
  if (session.res === res) session.res = null;
}

function writeEvent(res: http.ServerResponse, event: CcEvent): boolean {
  try {
    return res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (err) {
    log.warn("SSE write failed: %s", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Returns false when the session is gone entirely (not merely disconnected). */
export function pushEvent(sessionId: string, event: CcEvent): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (s.res) {
    writeEvent(s.res, event);
    return true;
  }
  if (s.queue.length >= QUEUE_MAX) s.queue.shift();
  s.queue.push(event);
  return true;
}

// A machine that registers and then dies without ever attaching its stream (or
// after losing it for good) leaves an entry nothing will ever remove: the SSE
// close handler never fires because there is no stream. Sweep those.
//
// Half an hour rather than a few minutes because the common cause is a sleeping
// laptop: a lunch break should reconnect to the same session with its queued
// messages intact. Long enough to be useful, short enough that an overnight
// sleep reports "no live session" instead of pretending a corpse will answer.
const ORPHAN_TTL_MS = 30 * 60_000;

export function keepAlive(): void {
  const cutoff = Date.now() - ORPHAN_TTL_MS;
  for (const s of sessions.values()) {
    if (!s.res) {
      if (s.lastSeenAt < cutoff) {
        log.info("session %s dropped: no stream for %d min", s.id, ORPHAN_TTL_MS / 60_000);
        sessions.delete(s.id);
        for (const [requestId, owner] of permissionOwners) {
          if (owner.sessionId === s.id) permissionOwners.delete(requestId);
        }
      }
      continue;
    }
    try {
      s.res.write(": ping\n\n");
      s.lastSeenAt = Date.now();
    } catch {
      s.res = null;
    }
  }
}

export function unregisterSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.res) {
    try {
      s.res.end();
    } catch {
      // already torn down
    }
  }
  sessions.delete(sessionId);
  for (const [requestId, owner] of permissionOwners) {
    if (owner.sessionId === sessionId) permissionOwners.delete(requestId);
  }
  log.info("session unregistered: %s", sessionId);
}

/**
 * Inbound Telegram messages address a topic, not a session. When two sessions
 * share a topic (same machine, same project) the most recently started one wins:
 * that is the terminal the user just opened and is thinking about.
 */
export function newestSessionForThread(threadId: number): Session | null {
  let best: Session | null = null;
  for (const s of sessions.values()) {
    if (s.threadId !== threadId) continue;
    if (!best || s.startedAt > best.startedAt) best = s;
  }
  return best;
}

/** A session with no attached stream is registered but unreachable right now. */
export function isSessionOnline(sessionId: string): boolean {
  return sessions.get(sessionId)?.res != null;
}

export function countSessionsForThread(threadId: number): number {
  return sessionsForThread(threadId).length;
}

/** Oldest first, so the list reads in the order the sessions appeared. */
export function sessionsForThread(threadId: number): Session[] {
  return Array.from(sessions.values())
    .filter((s) => s.threadId === threadId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function getSession(sessionId: string): Session | null {
  return sessions.get(sessionId) ?? null;
}

export function rememberPermission(requestId: string, sessionId: string): void {
  sweepPermissions();
  permissionOwners.set(requestId, { sessionId, at: Date.now() });
}

export function takePermissionOwner(requestId: string): string | null {
  const owner = permissionOwners.get(requestId);
  if (!owner) return null;
  permissionOwners.delete(requestId);
  if (Date.now() - owner.at > PERMISSION_TTL_MS) return null;
  return owner.sessionId;
}

function sweepPermissions(): void {
  const cutoff = Date.now() - PERMISSION_TTL_MS;
  for (const [requestId, owner] of permissionOwners) {
    if (owner.at < cutoff) permissionOwners.delete(requestId);
  }
}

// ─── Pending attachments ─────────────────────────────────────────────────────
//
// Only the Telegram file_id is held, never a resolved URL: those embed the bot
// token, and the download link expires anyway. The machine redeems the key
// through the hub, which resolves and proxies the bytes at that moment.

const FILE_TTL_MS = 60 * 60_000;

interface PendingFile {
  sessionId: string;
  fileId: string;
  name: string;
  mime: string;
  size: number;
  at: number;
}

const pendingFiles = new Map<string, PendingFile>();

export function rememberFile(input: Omit<PendingFile, "at">): string {
  const cutoff = Date.now() - FILE_TTL_MS;
  for (const [k, f] of pendingFiles) if (f.at < cutoff) pendingFiles.delete(k);

  const key = newId(12);
  pendingFiles.set(key, { ...input, at: Date.now() });
  return key;
}

/** Kept rather than consumed: a retried download after a dropped connection must work. */
export function getFile(key: string, sessionId: string): PendingFile | null {
  const f = pendingFiles.get(key);
  if (!f || f.sessionId !== sessionId) return null;
  if (Date.now() - f.at > FILE_TTL_MS) {
    pendingFiles.delete(key);
    return null;
  }
  return f;
}

export function listSessions(): CcSessionInfo[] {
  return Array.from(sessions.values())
    .sort((a, b) => a.machine.localeCompare(b.machine) || a.project.localeCompare(b.project))
    .map((s) => ({
      id: s.id,
      machine: s.machine,
      hostname: s.hostname,
      cwd: s.cwd,
      project: s.project,
      branch: s.branch,
      threadId: s.threadId,
      connected: s.res !== null,
      startedAt: new Date(s.startedAt).toISOString(),
      lastSeenAt: new Date(s.lastSeenAt).toISOString(),
    }));
}

export type { Session as CcSession };
