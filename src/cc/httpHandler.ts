// Native (non-Hono) routes for the Claude Code bridge, mounted at /cc/*.
//
// Native rather than Hono for two reasons: the global /api middleware demands
// Telegram InitData, which a headless machine cannot produce, and the SSE stream
// wants the raw ServerResponse rather than a buffered Request/Response bridge.
import type http from "http";
import { createLogger } from "../utils/logger.js";
import {
  attachStream,
  authorize,
  countOnlineSessionsForThread,
  countSessionsForThread,
  countSessionsForUser,
  detachStream,
  getFile,
  keepAlive,
  registerSession,
  unregisterSession,
  type CcSession,
} from "./registry.js";
import {
  announceAddressingChange,
  announceSecondSession,
  announceSession,
  announceSessionEnd,
  ensureTopic,
  isCcConfigured,
  openTelegramFile,
  postPermission,
  postReply,
} from "../services/ccBridgeService.js";
import { resolveMachineToken } from "./accessRepository.js";
import type { CcPermissionRequest, CcRegisterRequest, CcReplyRequest } from "./types.js";

const log = createLogger("cc-http");

const BODY_LIMIT = 256 * 1024;
const KEEPALIVE_MS = 20_000;
// Unauthenticated /cc/register is the only guessable surface; bound it so a
// leaked hostname cannot be used to grind the machine token.
const REGISTER_WINDOW_MS = 60_000;
const REGISTER_MAX = 20;
const registerHits = new Map<string, number[]>();

let keepAliveTimer: NodeJS.Timeout | null = null;

function startKeepAlive(): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(keepAlive, KEEPALIVE_MS);
  // Never hold the process open just to ping idle streams.
  keepAliveTimer.unref();
}

export function stopCcKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearer(req: http.IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function registerRateLimited(key: string): boolean {
  const now = Date.now();
  for (const [k, hits] of registerHits) {
    if (hits.length === 0 || hits[hits.length - 1] < now - REGISTER_WINDOW_MS) registerHits.delete(k);
  }
  const hits = (registerHits.get(key) ?? []).filter((t) => now - t < REGISTER_WINDOW_MS);
  hits.push(now);
  registerHits.set(key, hits);
  return hits.length > REGISTER_MAX;
}

function clientKey(req: http.IncomingMessage): string {
  return (
    String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function parseJsonBody<T>(raw: string): T | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Resolves the session addressed by ?session=<id> plus its bearer token. */
function sessionFrom(req: http.IncomingMessage, searchParams: URLSearchParams): CcSession | null {
  const id = searchParams.get("session");
  const token = bearer(req);
  if (!id || !token) return null;
  return authorize(id, token);
}

async function handleRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (registerRateLimited(clientKey(req))) {
    sendJson(res, 429, { ok: false, error: "Too many requests" });
    return;
  }
  const presented = bearer(req);
  const machine = presented ? await resolveMachineToken(presented) : null;
  if (!machine) {
    // Unknown digest, revoked token and suspended access answer alike: a probe
    // should not learn which of the three it hit.
    sendJson(res, 401, { ok: false, error: "Bad machine token" });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 413, { ok: false, error: "Payload too large" });
    return;
  }

  const body = parseJsonBody<CcRegisterRequest>(raw);
  if (!body?.machine || !body.hostname || !body.cwd || !body.project) {
    sendJson(res, 400, { ok: false, error: "machine, hostname, cwd and project are required" });
    return;
  }

  // "unknown" was the client's old fallback for a name it could not slugify.
  // Two machines answering to it would share every topic, so refuse it here too
  // rather than trusting the client to have been fixed.
  const machineName = String(body.machine).trim().slice(0, 64);
  if (!machineName || machineName === "unknown") {
    sendJson(res, 400, { ok: false, error: "machine must be a distinct non-empty name" });
    return;
  }
  const project = String(body.project).slice(0, 128);
  const cwd = String(body.cwd).slice(0, 512);
  const sessionName = String(body.session ?? "").trim().slice(0, 60);

  const groupId = machine.access.groupId;
  if (groupId === null) {
    sendJson(res, 409, {
      ok: false,
      error: "No Telegram group is bound to this account yet — run /code bind in your group",
    });
    return;
  }

  if (countSessionsForUser(machine.userId) >= machine.access.maxSessions) {
    sendJson(res, 429, { ok: false, error: "Too many live sessions for this account" });
    return;
  }

  let topic: Awaited<ReturnType<typeof ensureTopic>>;
  try {
    topic = await ensureTopic(machine.userId, groupId, machineName, cwd, project, sessionName);
  } catch (err) {
    log.error("ensureTopic failed: %s", err instanceof Error ? err.message : String(err));
    sendJson(res, 503, { ok: false, error: "Could not open a Telegram topic" });
    return;
  }

  const threadId = topic.threadId;
  const reconnect = countSessionsForThread(threadId) > 0;
  // Only a session that can actually talk counts as a rival for the topic.
  const rivals = countOnlineSessionsForThread(threadId);
  const { sessionId, sessionToken } = registerSession({
    userId: machine.userId,
    groupId,
    machine: machineName,
    hostname: String(body.hostname).slice(0, 128),
    cwd,
    project,
    branch: body.branch ? String(body.branch).slice(0, 128) : null,
    threadId,
  });

  sendJson(res, 200, { ok: true, sessionId, sessionToken, threadId });

  const session = authorize(sessionId, sessionToken);
  if (session) {
    const announce =
      rivals > 0 ? announceSecondSession(session) : announceSession(session, reconnect, topic.idleMs);
    await announce.catch((err: unknown) => {
      log.error("announce failed: %s", err instanceof Error ? err.message : String(err));
    });
  }
}

function handleStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  searchParams: URLSearchParams,
): void {
  const session = sessionFrom(req, searchParams);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Unknown session" });
    return;
  }

  // Proxies buffer by default, which would hold events until the stream closes.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);
  res.write(": connected\n\n");

  attachStream(session, res);
  startKeepAlive();

  res.on("close", () => detachStream(session, res));
}

async function handleReply(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  searchParams: URLSearchParams,
): Promise<void> {
  const session = sessionFrom(req, searchParams);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Unknown session" });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 413, { ok: false, error: "Payload too large" });
    return;
  }

  const body = parseJsonBody<CcReplyRequest>(raw);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    sendJson(res, 400, { ok: false, error: "text is required" });
    return;
  }

  await postReply(session, text, countOnlineSessionsForThread(session.threadId) > 1);
  sendJson(res, 200, { ok: true });
}

async function handlePermission(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  searchParams: URLSearchParams,
): Promise<void> {
  const session = sessionFrom(req, searchParams);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Unknown session" });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 413, { ok: false, error: "Payload too large" });
    return;
  }

  const body = parseJsonBody<CcPermissionRequest>(raw);
  if (!body?.requestId || !body.toolName) {
    sendJson(res, 400, { ok: false, error: "requestId and toolName are required" });
    return;
  }

  await postPermission(session, {
    requestId: String(body.requestId).slice(0, 32),
    toolName: String(body.toolName).slice(0, 64),
    description: String(body.description ?? "").slice(0, 1000),
    inputPreview: String(body.inputPreview ?? "").slice(0, 1000),
  });
  sendJson(res, 200, { ok: true });
}

/**
 * Redeems an attachment key for the bytes. The hub proxies rather than
 * redirecting so the Telegram URL — which carries the bot token — never reaches
 * the machine.
 */
async function handleFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  searchParams: URLSearchParams,
): Promise<void> {
  const session = sessionFrom(req, searchParams);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Unknown session" });
    return;
  }

  const key = searchParams.get("key") ?? "";
  const file = getFile(key, session.id);
  if (!file) {
    sendJson(res, 404, { ok: false, error: "Unknown or expired attachment" });
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await openTelegramFile(file.fileId);
  } catch (err) {
    log.error("file fetch failed: %s", err instanceof Error ? err.message : String(err));
    sendJson(res, 502, { ok: false, error: "Could not fetch the file from Telegram" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": file.mime || "application/octet-stream",
    "Content-Length": String(bytes.length),
    "Cache-Control": "no-store",
  });
  res.end(bytes);
}

async function handleBye(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  searchParams: URLSearchParams,
): Promise<void> {
  const session = sessionFrom(req, searchParams);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Unknown session" });
    return;
  }
  sendJson(res, 200, { ok: true });
  const last = countSessionsForThread(session.threadId) <= 1;
  unregisterSession(session.id);
  if (last) {
    await announceSessionEnd(session).catch(() => {});
  } else {
    // Someone else inherits the topic — say who, or the next message goes to a
    // session the user was not thinking about.
    await announceAddressingChange(session.threadId).catch(() => {});
  }
}

/** Returns true when the request was for /cc/* and has been answered. */
export async function handleCcRequest(
  pathname: string,
  searchParams: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (pathname !== "/cc" && !pathname.startsWith("/cc/")) return false;

  if (!isCcConfigured()) {
    sendJson(res, 503, { ok: false, error: "Claude Code bridge is not configured" });
    return true;
  }

  try {
    if (req.method === "POST" && pathname === "/cc/register") {
      await handleRegister(req, res);
    } else if (req.method === "GET" && pathname === "/cc/stream") {
      handleStream(req, res, searchParams);
    } else if (req.method === "POST" && pathname === "/cc/reply") {
      await handleReply(req, res, searchParams);
    } else if (req.method === "POST" && pathname === "/cc/permission") {
      await handlePermission(req, res, searchParams);
    } else if (req.method === "GET" && pathname === "/cc/file") {
      await handleFile(req, res, searchParams);
    } else if (req.method === "POST" && pathname === "/cc/bye") {
      await handleBye(req, res, searchParams);
    } else {
      sendJson(res, 404, { ok: false, error: "Unknown bridge endpoint" });
    }
  } catch (err) {
    log.error("bridge error: %s", err instanceof Error ? err.message : String(err));
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Bridge error" });
  }
  return true;
}
