/**
 * Interactive MTProto login that captures a session string into a SEPARATE file,
 * without touching the digest session (data/telegram-session/session.txt). Use it
 * to authorize an allow-listed account (e.g. the owner/admin) for
 * scripts/bot-smoke.ts so /start renders the full member menu.
 *
 * Run:
 *   npm run tg-session                                   # → data/telegram-session/admin-session.txt
 *   npm run tg-session -- --out=data/telegram-session/other.txt
 *
 * Then:
 *   npm run bot-smoke -- --session-file=data/telegram-session/admin-session.txt
 *
 * Notes:
 *   - Log in with the phone of an ALLOW-LISTED bot account, otherwise /start
 *     still shows the onboarding screen.
 *   - This creates a new authorized session on that account (Telegram may send a
 *     login alert to it). The session string is a credential — it is written to a
 *     gitignored file under data/ and never printed here. Do not commit it.
 *   - It refuses to overwrite the digest session file by default.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { createInterface } from "readline";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const DIGEST_SESSION_FILE = resolve("./data/telegram-session/session.txt");
const DEFAULT_OUT = "./data/telegram-session/admin-session.txt";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

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
    console.error("Set TELEGRAM_PARSER_API_ID and TELEGRAM_PARSER_API_HASH in .env / .env.local");
    process.exit(1);
  }

  const outPath = arg("out") ?? DEFAULT_OUT;
  if (resolve(outPath) === DIGEST_SESSION_FILE && !process.argv.includes("--force")) {
    console.error(
      `Refusing to overwrite the digest session (${DIGEST_SESSION_FILE}). ` +
        `Pick a different --out= path, or pass --force if you really mean it.`,
    );
    process.exit(1);
  }

  console.log("=== MTProto session capture (for bot-smoke) ===");
  console.log("Use the phone of an ALLOW-LISTED bot account (e.g. the admin) to see the full menu.\n");

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });

  await client.start({
    phoneNumber: async () => await ask("Phone number (with country code, e.g. +7...): "),
    password: async () => await ask("2FA password (if enabled, else Enter): "),
    phoneCode: async () => await ask("Verification code from Telegram: "),
    onError: (err) => console.error("Auth error:", err),
  });

  const me = await client.getMe();
  const meId = (me as { id?: unknown }).id;
  const meName = (me as { username?: string; firstName?: string }).username ??
    (me as { firstName?: string }).firstName ?? "?";

  const sessionStr = client.session.save() as unknown as string;
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), sessionStr, "utf-8");

  console.log(`\n✅ Авторизован как @${meName} (id ${meId}).`);
  console.log(`Сессия сохранена в ${outPath} (секрет не печатаю; data/ в .gitignore).`);
  console.log(`\nТеперь сними меню:\n  npm run bot-smoke -- --session-file=${outPath}\n`);

  await client.disconnect();
  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
