import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { createHmac, timingSafeEqual } from "crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = "./data/tokens";

/** Thrown when the user has not linked a calendar yet. */
export class NoCalendarLinkedError extends Error {
  constructor() {
    super("Сначала привяжите календарь. Отправьте /auth");
    this.name = "NoCalendarLinkedError";
  }
}

function getTokenPath(userId: string): string {
  return `${TOKENS_DIR}/${userId}.json`;
}

const OAUTH_TOKEN_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}

function getRedirectUri(): string {
  const uri = process.env.OAUTH_REDIRECT_URI?.trim();
  if (!uri) {
    throw new Error("OAUTH_REDIRECT_URI must be set for calendar linking (Google has blocked the legacy OOB flow)");
  }
  return uri;
}

/* ── Signed OAuth state ──────────────────────────────────────────────
 * The Google OAuth `state` round-trips through the user's browser; without a
 * signature any attacker can hit /<oauth-callback>?code=<own>&state=<victim_id>
 * and overwrite the victim's stored tokens. We sign state with the bot token
 * (server-side secret) so callbacks must originate from a getAuthUrl() we issued.
 */
const OAUTH_STATE_TTL_SEC = 30 * 60; // 30 min — typical user delay between /auth and consent

function getStateSecret(): Buffer {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN must be set to sign OAuth state");
  return createHmac("sha256", "oauth-state").update(token).digest();
}

function signOAuthState(userId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${issuedAt}`;
  const sig = createHmac("sha256", getStateSecret()).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${sig}`;
}

/** Returns the trusted Telegram user id encoded in `state`, or null if invalid/expired. */
export function verifyOAuthState(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedAtStr, sig] = parts;
  if (!userId || !issuedAtStr || !sig) return null;
  const expected = createHmac("sha256", getStateSecret()).update(`${userId}.${issuedAtStr}`).digest("hex").slice(0, 32);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (Math.floor(Date.now() / 1000) - issuedAt > OAUTH_STATE_TTL_SEC) return null;
  return userId;
}

/**
 * Returns auth URL for the user to open. The `state` parameter is HMAC-signed
 * with the bot token so callback handlers can recover a verified userId.
 */
export function getAuthUrl(userId?: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    getRedirectUri()
  );
  const options: { access_type: string; scope: string[]; prompt: string; state?: string } = {
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  };
  if (userId) options.state = signOAuthState(userId);
  return oauth2Client.generateAuthUrl(options);
}

/**
 * Save OAuth tokens for a user (from redirect callback or manual /auth code).
 */
export async function saveTokenFromCode(code: string, userId: string): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    getRedirectUri()
  );
  const tokenResponse = await withTimeout(
    oauth2Client.getToken({ code: code.trim(), redirect_uri: getRedirectUri() }),
    OAUTH_TOKEN_TIMEOUT_MS,
    "Превышено время ожидания ответа от Google"
  );
  const { tokens } = tokenResponse;
  const tokenPath = getTokenPath(userId);
  await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, JSON.stringify(tokens), { encoding: "utf8", mode: 0o600 });
}

/**
 * Check if the user has a stored token (without throwing).
 */
export async function hasToken(userId: string): Promise<boolean> {
  const tokenPath = getTokenPath(userId);
  try {
    await readFile(tokenPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get OAuth2 client for the given user. Throws NoCalendarLinkedError if no token.
 */
export async function getAuthClient(userId: string): Promise<OAuth2Client> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    getRedirectUri()
  );
  const tokenPath = getTokenPath(userId);
  let tokens: unknown;
  try {
    const data = await readFile(tokenPath, "utf8");
    tokens = JSON.parse(data);
  } catch {
    throw new NoCalendarLinkedError();
  }
  oauth2Client.setCredentials(tokens as Parameters<OAuth2Client["setCredentials"]>[0]);
  oauth2Client.on("tokens", async (newTokens) => {
    const merged = { ...(oauth2Client.credentials as Record<string, unknown>), ...newTokens };
    await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
    await writeFile(tokenPath, JSON.stringify(merged), { encoding: "utf8", mode: 0o600 });
  });
  return oauth2Client;
}
