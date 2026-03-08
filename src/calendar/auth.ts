import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const __dirname = dirname(fileURLToPath(import.meta.url));

function getTokenPath(): string {
  return process.env.GOOGLE_TOKEN_PATH ?? "./data/token.json";
}

export function getAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function saveTokenFromCode(code: string): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  const { tokens } = await oauth2Client.getToken(code.trim());
  const tokenPath = getTokenPath();
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, JSON.stringify(tokens), "utf8");
}

export async function getAuthClient(): Promise<OAuth2Client> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  const tokenPath = getTokenPath();
  let tokens: unknown;
  try {
    const data = await readFile(tokenPath, "utf8");
    tokens = JSON.parse(data);
  } catch {
    throw new Error(
      `No token found at ${tokenPath}. Run "npm run authorize" first.`
    );
  }
  oauth2Client.setCredentials(tokens as Parameters<OAuth2Client["setCredentials"]>[0]);
  oauth2Client.on("tokens", async (newTokens) => {
    const merged = { ...(oauth2Client.credentials as Record<string, unknown>), ...newTokens };
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, JSON.stringify(merged), "utf8");
  });
  return oauth2Client;
}
