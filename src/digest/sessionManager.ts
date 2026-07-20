import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { telegramMtprotoSessions } from "../db/schema.js";
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

export async function saveUserSession(
  userId: number,
  sessionString: string,
  phoneHint: string | null
): Promise<void> {
  await db
    .insert(telegramMtprotoSessions)
    .values({ userId, sessionString, phoneHint, isActive: true, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: telegramMtprotoSessions.userId,
      set: {
        sessionString: sql`excluded.session_string`,
        phoneHint: sql`excluded.phone_hint`,
        isActive: true,
        updatedAt: sql`now()`,
      },
    });
}

export async function getUserSession(
  userId: number
): Promise<{ sessionString: string; phoneHint: string | null; isActive: boolean } | null> {
  const [row] = await db
    .select({
      sessionString: telegramMtprotoSessions.sessionString,
      phoneHint: telegramMtprotoSessions.phoneHint,
      isActive: telegramMtprotoSessions.isActive,
    })
    .from(telegramMtprotoSessions)
    .where(eq(telegramMtprotoSessions.userId, userId));
  if (!row) return null;
  return {
    sessionString: row.sessionString,
    phoneHint: row.phoneHint,
    isActive: row.isActive,
  };
}

export async function hasActiveSession(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: telegramMtprotoSessions.id })
    .from(telegramMtprotoSessions)
    .where(and(eq(telegramMtprotoSessions.userId, userId), eq(telegramMtprotoSessions.isActive, true)))
    .limit(1);
  return !!row;
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

  // Telegram may rotate keys on connect; persist the refreshed session.
  const newSessionStr = client.session.save() as unknown as string;
  if (newSessionStr && newSessionStr !== session.sessionString) {
    await saveUserSession(userId, newSessionStr, session.phoneHint);
    log.debug(`User ${userId} session updated.`);
  }

  return client;
}

/** Uses destroy() rather than disconnect() to stop GramJS's internal update loop. */
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

/** Uses destroy() rather than disconnect() to stop GramJS's internal update loops. */
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
