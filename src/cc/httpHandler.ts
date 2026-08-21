// Native (non-Hono) routes for the Claude Code bridge, mounted at /cc/*.
//
// Native rather than Hono for two reasons: the global /api middleware demands
// Telegram InitData, which a headless machine cannot produce, and the SSE stream
// wants the raw ServerResponse rather than a buffered Request/Response bridge.
import type http from "http";
import { timingSafeEqual } from "crypto";
import { createLogger } from "../utils/logger.js";
import {
  attachStream,
  authorize,
  countSessionsForThread,
  detachStream,
  getFile,
  keepAlive,
  registerSession,
  unregisterSession,
  type CcSession,
} from "./registry.js";
import {
  announceSession,
  announceSessionEnd,
  ensureTopic,
  isCcConfigured,
  openTelegramFile,
  postPermission,
  postReply,
} from "../services/ccBridgeService.js";
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

/** The machine token is a long-lived shared secret, so compare it in constant time. */
function machineTokenValid(presented: string | null): boolean {
  const expected = process.env.CC_MACHINE_TOKEN?.trim();
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
  if (!machineTokenValid(bearer(req))) {
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

  const machine = String(body.machine).slice(0, 64);
  const project = String(body.project).slice(0, 128);
  const cwd = String(body.cwd).slice(0, 512);
  const sessionName = String(body.session ?? "").trim().slice(0, 60);

  let threadId: number;
  try {
    threadId = await ensureTopic(machine, cwd, project, sessionName);
  } catch (err) {
    log.error("ensureTopic failed: %s", err instanceof Error ? err.message : String(err));
    sendJson(res, 503, { ok: false, error: "Could not open a Telegram topic" });
    return;
  }

  const reconnect = countSessionsForThread(threadId) > 0;
  const { sessionId, sessionToken } = registerSession({
    machine,
    hostname: String(body.hostname).slice(0, 128),
    cwd,
    project,
    branch: body.branch ? String(body.branch).slice(0, 128) : null,
    threadId,
  });

  sendJson(res, 200, { ok: true, sessionId, sessionToken, threadId });

  const session = authorize(sessionId, sessionToken);
  if (session) {
    await announceSession(session, reconnect).catch((err: unknown) => {
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

  await postReply(session, text, countSessionsForThread(session.threadId) > 1);
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
