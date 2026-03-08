import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = "./data/tokens";

/** Thrown when the user has not linked a calendar yet. */
export class NoCalendarLinkedError extends Error {
  constructor() {
    super("Сначала привяжите календарь. Отправьте /start");
    this.name = "NoCalendarLinkedError";
  }
}

function getTokenPath(userId: string): string {
  return `${TOKENS_DIR}/${userId}.json`;
}

function getRedirectUri(): string {
  const uri = process.env.OAUTH_REDIRECT_URI?.trim();
  if (!uri) {
    throw new Error("OAUTH_REDIRECT_URI must be set for calendar linking (Google has blocked the legacy OOB flow)");
  }
  return uri;
}

/**
 * Returns auth URL for the user to open. state = Telegram user id (for callback).
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
  if (userId) options.state = userId;
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
  const { tokens } = await oauth2Client.getToken({ code: code.trim(), redirect_uri: getRedirectUri() });
  const tokenPath = getTokenPath(userId);
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, JSON.stringify(tokens), "utf8");
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
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, JSON.stringify(merged), "utf8");
  });
  return oauth2Client;
}
