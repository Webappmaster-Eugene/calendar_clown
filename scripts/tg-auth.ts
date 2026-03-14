/**
 * Interactive script to authorize a Telegram user account for MTProto (GramJS).
 * Run: npm run tg-auth
 *
 * This will prompt for phone number and verification code,
 * then save the session string to data/telegram-session/session.txt.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { createInterface } from "readline";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const SESSION_DIR = "./data/telegram-session";
const SESSION_FILE = join(SESSION_DIR, "session.txt");

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const apiId = parseInt(process.env.TELEGRAM_PARSER_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_PARSER_API_HASH?.trim();

  if (!apiId || !apiHash) {
    console.error("Set TELEGRAM_PARSER_API_ID and TELEGRAM_PARSER_API_HASH in .env");
    process.exit(1);
  }

  console.log("=== Telegram MTProto Authorization ===");
  console.log("This will authorize a user account for reading public channels.");
  console.log("Use a DEDICATED phone number, not your primary account.\n");

  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.start({
    phoneNumber: async () => await ask("Phone number (with country code, e.g. +7...): "),
    password: async () => await ask("2FA password (if enabled, otherwise press Enter): "),
    phoneCode: async () => await ask("Verification code from Telegram: "),
    onError: (err) => console.error("Auth error:", err),
  });

  console.log("\nAuthorization successful!");

  const sessionStr = client.session.save() as unknown as string;
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(SESSION_FILE, sessionStr, "utf-8");
  console.log(`Session saved to ${SESSION_FILE}`);
  console.log("You can now use the digest mode.\n");

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
