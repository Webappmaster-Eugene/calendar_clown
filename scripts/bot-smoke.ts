/**
 * MTProto smoke test of the bot's /start flow and menu, driven as a real user.
 *
 * Logs in with a saved user-account StringSession (same format as `npm run tg-auth`),
 * sends /start to the bot, then prints the reply text and the menu it renders
 * (both persistent reply-keyboards and inline keyboards). Optionally selects one
 * menu item (--click=<index|text>) to verify that navigation responds.
 *
 * Read-only by default: /start only renders the welcome + menu, it mutates nothing.
 * --click that lands on a mode button DOES switch the account's bot mode (reversible).
 *
 * Requirements (all live on prod — see the runbook in the reply, do NOT reuse the
 * digest session from a second IP concurrently, Telegram may revoke it):
 *   - TELEGRAM_PARSER_API_ID / TELEGRAM_PARSER_API_HASH
 *   - a session string via TELEGRAM_SESSION env, or data/telegram-session/session.txt
 *   - the account must be allow-listed in the bot, otherwise you get the deny screen
 *
 * Usage:
 *   npx tsx scripts/bot-smoke.ts                       # /start + dump menu
 *   npx tsx scripts/bot-smoke.ts --bot=numart_clown_bot
 *   npx tsx scripts/bot-smoke.ts --session-file=data/telegram-session/admin-session.txt
 *   npx tsx scripts/bot-smoke.ts --click=Расходы       # then follow the reply
 *   npx tsx scripts/bot-smoke.ts --click=1             # click the 1st button
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { readFile } from "fs/promises";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const SESSION_FILE = join("./data/telegram-session", "session.txt");
const REPLY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;

interface ParsedButton {
  text: string;
  kind: "callback" | "url" | "webview" | "text" | "other";
  data?: string; // callback payload (utf-8 if printable, else hex)
  url?: string;
  raw?: Buffer; // raw callback bytes, for --click
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSession(): Promise<string> {
  const fileArg = arg("session-file");
  if (fileArg) return (await readFile(fileArg, "utf-8")).trim();
  const envSession = process.env.TELEGRAM_SESSION?.trim();
  if (envSession) return envSession;
  try {
    return (await readFile(SESSION_FILE, "utf-8")).trim();
  } catch {
    return "";
  }
}

/** Decode a callback-data buffer to a readable string (utf-8 if printable, else hex). */
function decodeCallbackData(buf: Buffer): string {
  const text = buf.toString("utf-8");
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7Eа-яА-ЯёЁ:_\-/|.]+$/.test(text) ? text : buf.toString("hex");
}

/** Flatten a message's reply markup (inline or persistent keyboard) into rows of buttons. */
function parseMarkup(markup: Api.TypeReplyMarkup | undefined): ParsedButton[][] {
  if (!markup) return [];
  const rows = (markup as { rows?: Api.KeyboardButtonRow[] }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) =>
    row.buttons.map((b): ParsedButton => {
      const cn = (b as { className?: string }).className ?? "";
      const text = (b as { text?: string }).text ?? "";
      if (cn === "KeyboardButtonCallback") {
        const raw = Buffer.from((b as Api.KeyboardButtonCallback).data);
        return { text, kind: "callback", data: decodeCallbackData(raw), raw };
      }
      if (cn === "KeyboardButtonUrl") return { text, kind: "url", url: (b as Api.KeyboardButtonUrl).url };
      if (cn === "KeyboardButtonWebView" || cn === "KeyboardButtonSimpleWebView") {
        return { text, kind: "webview", url: (b as Api.KeyboardButtonWebView).url };
      }
      if (cn === "KeyboardButton") return { text, kind: "text" };
      return { text: text || cn, kind: "other" };
    }),
  );
}

function markupKind(markup: Api.TypeReplyMarkup | undefined): string {
  const cn = (markup as { className?: string })?.className ?? "none";
  return cn.replace(/^Api\./, "");
}

/** Poll for bot messages newer than `afterId` until one arrives or timeout. */
async function waitForReply(
  client: TelegramClient,
  peer: Api.TypeInputPeer | string,
  afterId: number,
): Promise<Api.Message[]> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const msgs = await client.getMessages(peer, { minId: afterId, limit: 10 });
    const fromBot = msgs.filter((m) => !m.out && m.id > afterId);
    if (fromBot.length > 0) return fromBot.sort((a, b) => a.id - b.id);
  }
  return [];
}

function printMessages(label: string, msgs: Api.Message[]): ParsedButton[] {
  console.log(`\n=== ${label} ===`);
  if (msgs.length === 0) {
    console.log("  (нет ответа в отведённое время)");
    return [];
  }
  const flat: ParsedButton[] = [];
  let idx = 0;
  for (const m of msgs) {
    const body = (m.message ?? "").trim();
    console.log(`\n[msg ${m.id}] ${body ? body.slice(0, 800) : "(без текста)"}`);
    const kind = markupKind(m.replyMarkup);
    if (m.replyMarkup) {
      console.log(`  клавиатура: ${kind}`);
      for (const row of parseMarkup(m.replyMarkup)) {
        console.log(
          "   " +
            row
              .map((b) => {
                flat.push(b);
                const tag =
                  b.kind === "callback"
                    ? `cb:${b.data}`
                    : b.kind === "url" || b.kind === "webview"
                      ? `${b.kind}:${b.url}`
                      : b.kind;
                return `[${idx++}] ${b.text} (${tag})`;
              })
              .join("  "),
        );
      }
    }
  }
  return flat;
}

/** The 18 bot modes and their slash-command entry points (safe, read-only screens). */
const MODE_COMMANDS: Array<{ label: string; cmd: string }> = [
  { label: "Календарь", cmd: "/calendar" },
  { label: "Расходы", cmd: "/expenses" },
  { label: "Транскрибация", cmd: "/transcribe" },
  { label: "Упрощатель", cmd: "/simplifier" },
  { label: "База знаний", cmd: "/gandalf" },
  { label: "Дайджест", cmd: "/digest" },
  { label: "Даты", cmd: "/dates" },
  { label: "Вишлист", cmd: "/wishlist" },
  { label: "Нейро", cmd: "/neuro" },
  { label: "Цели", cmd: "/goals" },
  { label: "Напоминания", cmd: "/reminders" },
  { label: "OSINT", cmd: "/osint" },
  { label: "Резюме", cmd: "/summarizer" },
  { label: "Блогер", cmd: "/blogger" },
  { label: "Нутрициолог", cmd: "/nutritionist" },
  { label: "Задачи", cmd: "/tasks" },
  { label: "Рассылка", cmd: "/broadcast" },
  { label: "Админка", cmd: "/admin" },
];

interface SweepResult {
  cmd: string;
  label: string;
  ok: boolean;
  buttons: number;
  preview: string;
}

/** Enter every mode via its slash command and record whether the bot rendered a screen. */
async function sweepModes(client: TelegramClient, peer: Api.TypeInputPeer): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  console.log(`\n=== Sweep: вход во все ${MODE_COMMANDS.length} режимов ===`);
  for (const m of MODE_COMMANDS) {
    const sent = await client.sendMessage(peer, { message: m.cmd });
    const reply = await waitForReply(client, peer, sent.id);
    const preview = reply
      .map((r) => (r.message ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ⏎ ")
      .slice(0, 90);
    const buttons = reply.reduce((n, r) => n + parseMarkup(r.replyMarkup).flat().length, 0);
    const ok = reply.length > 0;
    results.push({ cmd: m.cmd, label: m.label, ok, buttons, preview });
    console.log(
      `  ${ok ? "✓" : "✗"} ${m.cmd.padEnd(14)} ${m.label.padEnd(14)} btns:${String(buttons).padEnd(3)} ${ok ? "«" + preview + "»" : "(нет ответа)"}`,
    );
    await sleep(1_500); // stay well under flood limits
  }
  return results;
}

async function main(): Promise<void> {
  const apiId = parseInt(process.env.TELEGRAM_PARSER_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_PARSER_API_HASH?.trim();
  if (!apiId || !apiHash) {
    console.error("Set TELEGRAM_PARSER_API_ID and TELEGRAM_PARSER_API_HASH (see .env on prod).");
    process.exit(1);
  }

  const sessionStr = await loadSession();
  if (!sessionStr) {
    console.error(
      `No MTProto session. Provide TELEGRAM_SESSION env or ${SESSION_FILE} (from \`npm run tg-auth\`).`,
    );
    process.exit(1);
  }

  const botUsername = (arg("bot") ?? process.env.TEST_BOT_USERNAME ?? "numart_clown_bot").replace(/^@/, "");
  const clickTarget = arg("click");

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 3,
  });

  try {
    await client.connect();
    const me = await client.getMe();
    const meName = (me as Api.User).username ?? (me as Api.User).firstName ?? "?";
    console.log(`Подключено как @${meName} (id ${(me as Api.User).id}). Бот: @${botUsername}`);

    const bot = await client.getEntity(botUsername);
    const peer = await client.getInputEntity(bot);

    // ── /start ──────────────────────────────────────────────────────────────
    const sent = await client.sendMessage(peer, { message: "/start" });
    console.log(`Отправлено /start (msg ${sent.id}), жду ответ...`);
    const startReply = await waitForReply(client, peer, sent.id);
    const buttons = printMessages("Ответ на /start", startReply);

    if (startReply.length === 0) {
      console.error("\n❌ Бот не ответил на /start за отведённое время.");
      process.exit(1);
    }

    const isOnboarding = buttons.some((b) => b.data === "onboard_request");
    if (isOnboarding) {
      console.warn(
        `\n⚠ Аккаунт @${meName} (id ${(me as Api.User).id}) НЕ в allowlist бота — ` +
          `показан онбординг, а не меню. Запусти под allow-listed аккаунтом ` +
          `(--session-file=... с сессией участника/админа).`,
      );
    } else {
      console.log(`\n✓ Меню участника получено (${buttons.length} кнопок).`);
    }

    // ── optional --sweep: enter every mode ────────────────────────────────────
    if (process.argv.includes("--sweep")) {
      const results = await sweepModes(client, peer);
      const okCount = results.filter((r) => r.ok).length;
      console.log(`\n=== Sweep итог: ${okCount}/${results.length} режимов ответили ===`);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        console.error(`❌ Не ответили: ${failed.map((r) => r.cmd).join(", ")}`);
        process.exit(1);
      }
      console.log("✅ Все режимы бота ответили.");
    }

    // ── optional --click ────────────────────────────────────────────────────
    if (clickTarget) {
      let target: ParsedButton | undefined;
      const asIndex = Number(clickTarget);
      if (Number.isInteger(asIndex) && buttons[asIndex]) target = buttons[asIndex];
      else target = buttons.find((b) => b.text.toLowerCase().includes(clickTarget.toLowerCase()));

      if (!target) {
        console.error(`\n❌ Кнопка "${clickTarget}" не найдена среди ${buttons.length} кнопок меню.`);
        process.exit(1);
      }
      console.log(`\n▶ Нажимаю кнопку: "${target.text}" (${target.kind})`);

      if (target.kind === "callback" && target.raw) {
        const answer = await client.invoke(
          new Api.messages.GetBotCallbackAnswer({ peer, msgId: sent.id, data: target.raw }),
        );
        if (answer.message) console.log(`  ответ callback (toast/alert): ${answer.message}`);
        const follow = await waitForReply(client, peer, sent.id + 1);
        printMessages(`После нажатия "${target.text}"`, follow);
      } else if (target.kind === "text") {
        const clickMsg = await client.sendMessage(peer, { message: target.text });
        const follow = await waitForReply(client, peer, clickMsg.id);
        printMessages(`После выбора "${target.text}"`, follow);
      } else {
        console.log(`  кнопка типа ${target.kind} (${target.url ?? ""}) — открывается вне чата, пропускаю.`);
      }
    }

    console.log("\n✅ Smoke-прогон бота завершён.");
  } finally {
    await client.disconnect();
    await client.destroy();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
