/**
 * Per-user MTProto session manager.
 * Manages multiple GramJS clients for different users.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { query } from "../db/connection.js";
import { connectGramClient } from "./telegramClient.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("mtproto-session");

/** Idle timeout before disconnecting user client (ms). */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface UserClientEntry {
  client: TelegramClient;
  idleTimer: ReturnType<typeof setTimeout>;
}

const userClients = new Map<number, UserClientEntry>();

// ─── Session Repository ──────────────────────────────────────────────────

interface SessionRow {
  session_string: string;
  phone_hint: string | null;
  is_active: boolean;
}

export async function saveUserSession(
  userId: number,
  sessionString: string,
  phoneHint: string | null
): Promise<void> {
  await query(
    `INSERT INTO telegram_mtproto_sessions (user_id, session_string, phone_hint, is_active, updated_at)
     VALUES ($1, $2, $3, true, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       session_string = EXCLUDED.session_string,
       phone_hint = EXCLUDED.phone_hint,
       is_active = true,
       updated_at = NOW()`,
    [userId, sessionString, phoneHint]
  );
}

export async function getUserSession(
  userId: number
): Promise<{ sessionString: string; phoneHint: string | null; isActive: boolean } | null> {
  const { rows } = await query<SessionRow>(
    "SELECT session_string, phone_hint, is_active FROM telegram_mtproto_sessions WHERE user_id = $1",
    [userId]
  );
  if (rows.length === 0) return null;
  return {
    sessionString: rows[0].session_string,
    phoneHint: rows[0].phone_hint,
    isActive: rows[0].is_active,
  };
}

export async function deactivateUserSession(userId: number): Promise<void> {
  await query(
    "UPDATE telegram_mtproto_sessions SET is_active = false, updated_at = NOW() WHERE user_id = $1",
    [userId]
  );
}

export async function hasActiveSession(userId: number): Promise<boolean> {
  const { rows } = await query<{ cnt: string }>(
    "SELECT COUNT(*) AS cnt FROM telegram_mtproto_sessions WHERE user_id = $1 AND is_active = true",
    [userId]
  );
  return Number(rows[0].cnt) > 0;
}

// ─── Client Manager ─────────────────────────────────────────────────────

function getCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = parseInt(process.env.TELEGRAM_PARSER_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_PARSER_API_HASH?.trim();
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

function resetIdleTimer(userId: number): void {
  const entry = userClients.get(userId);
  if (!entry) return;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    disconnectUser(userId);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Get a GramJS client for a specific user. Connects lazily.
 * Throws if no active session found or credentials missing.
 */
export async function getClientForUser(userId: number): Promise<TelegramClient> {
  const existing = userClients.get(userId);
  if (existing?.client.connected) {
    resetIdleTimer(userId);
    return existing.client;
  }

  const creds = getCredentials();
  if (!creds) throw new Error("TELEGRAM_PARSER_API_ID / TELEGRAM_PARSER_API_HASH not set");

  const session = await getUserSession(userId);
  if (!session || !session.isActive) {
    throw new Error("MTProto session not found for this user");
  }

  const stringSession = new StringSession(session.sessionString);
  const client = new TelegramClient(stringSession, creds.apiId, creds.apiHash, {
    connectionRetries: 3,
  });

  await client.connect();
  log.info(`User ${userId} MTProto client connected.`);

  const idleTimer = setTimeout(() => {
    disconnectUser(userId);
  }, IDLE_TIMEOUT_MS);

  userClients.set(userId, { client, idleTimer });

  // Update session if keys rotated
  const newSessionStr = client.session.save() as unknown as string;
  if (newSessionStr && newSessionStr !== session.sessionString) {
    await saveUserSession(userId, newSessionStr, session.phoneHint);
    log.debug(`User ${userId} session updated.`);
  }

  return client;
}

/** Get the admin (shared) GramJS client. Delegates to existing connectGramClient. */
export async function getAdminClient(): Promise<TelegramClient> {
  return connectGramClient();
}

/** Disconnect a specific user's client. Uses destroy() to stop the internal update loop. */
export function disconnectUser(userId: number): void {
  const entry = userClients.get(userId);
  if (entry) {
    clearTimeout(entry.idleTimer);
    entry.client.destroy().catch((err) => {
      log.warn(`Error disconnecting user ${userId}:`, err);
    });
    userClients.delete(userId);
    log.info(`User ${userId} MTProto client disconnected.`);
  }
}

/** Disconnect all user clients. Called on graceful shutdown. Uses destroy() to stop update loops. */
export function disconnectAll(): void {
  for (const [userId, entry] of userClients) {
    clearTimeout(entry.idleTimer);
    entry.client.destroy().catch((err) => {
      log.warn(`Error disconnecting user ${userId}:`, err);
    });
  }
  userClients.clear();
  log.info("All user MTProto clients disconnected.");
}
