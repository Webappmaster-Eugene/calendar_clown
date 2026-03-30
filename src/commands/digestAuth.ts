/**
 * MTProto auth flow for per-user Telegram session.
 * Allows users to link their Telegram account for folder import.
 *
 * Flow: phone → code → (optional 2FA) → session saved.
 */

import crypto from "crypto";
import type { Context } from "telegraf";
import type { Telegraf } from "telegraf";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { computeCheck } from "telegram/Password.js";
import { saveUserSession, hasActiveSession } from "../digest/sessionManager.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { createLogger } from "../utils/logger.js";
import { logAction } from "../logging/actionLogger.js";

const log = createLogger("digest-auth");

type AuthStep = "phone" | "code" | "password";

interface AuthFlowState {
  step: AuthStep;
  phoneNumber?: string;
  phoneCodeHash?: string;
  client?: TelegramClient;
}

const authStates = new Map<number, AuthFlowState>();

/* ── Bot reference for sending notifications from web flow ── */

let botRef: Telegraf | null = null;

export function setAuthBotRef(bot: Telegraf): void {
  botRef = bot;
}

/* ── Web auth tokens ── */

interface WebAuthToken {
  token: string;
  telegramId: number;
  chatId: number;
  createdAt: number;
}

const WEB_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

const webTokens = new Map<string, WebAuthToken>();

// Periodic cleanup of expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of webTokens) {
    if (now - data.createdAt > 15 * 60 * 1000) webTokens.delete(token);
  }
}, 5 * 60 * 1000);

/* ── Web auth result type and exported functions ── */

export type WebAuthResult =
  | { status: "success"; phoneHint: string }
  | { status: "2fa_required" }
  | { status: "invalid_code"; message: string }
  | { status: "expired" }
  | { status: "invalid_token" }
  | { status: "flood"; waitSeconds: number }
  | { status: "error"; message: string };

export function getAuthStateByToken(
  token: string
): { telegramId: number; chatId: number; state: AuthFlowState } | null {
  const webToken = webTokens.get(token);
  if (!webToken) return null;
  if (Date.now() - webToken.createdAt > WEB_TOKEN_TTL_MS) {
    webTokens.delete(token);
    return null;
  }
  const state = authStates.get(webToken.telegramId);
  if (!state) return null;
  return { telegramId: webToken.telegramId, chatId: webToken.chatId, state };
}

export async function submitCodeViaWeb(token: string, code: string): Promise<WebAuthResult> {
  const entry = getAuthStateByToken(token);
  if (!entry) return { status: "invalid_token" };
  const { telegramId, chatId, state } = entry;

  if (state.step !== "code") return { status: "error", message: "Unexpected step" };
  if (!state.client || !state.phoneNumber || !state.phoneCodeHash) {
    clearState(telegramId);
    return { status: "expired" };
  }

  const cleanCode = code.replace(/[\s\-]/g, "");
  if (!/^\d{4,8}$/.test(cleanCode)) {
    return { status: "invalid_code", message: "Код должен содержать 4-8 цифр." };
  }

  try {
    await state.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: state.phoneNumber,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: cleanCode,
      })
    );

    const hint = await saveSessionFromWeb(telegramId, chatId, state);
    return { status: "success", phoneHint: hint };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      authStates.set(telegramId, { ...state, step: "password" });
      return { status: "2fa_required" };
    }
    if (msg.includes("PHONE_CODE_INVALID")) {
      return { status: "invalid_code", message: "Неверный код. Попробуйте ещё раз." };
    }
    if (msg.includes("PHONE_CODE_EXPIRED")) {
      clearState(telegramId);
      webTokens.delete(token);
      return { status: "expired" };
    }
    if (msg.includes("FLOOD")) {
      const wait = msg.match(/\d+/);
      const seconds = wait ? parseInt(wait[0], 10) : 60;
      clearState(telegramId);
      webTokens.delete(token);
      return { status: "flood", waitSeconds: seconds };
    }

    log.error(`submitCodeViaWeb error for ${telegramId}: ${msg}`);
    clearState(telegramId);
    webTokens.delete(token);
    return { status: "error", message: msg };
  }
}

export async function submit2faViaWeb(token: string, password: string): Promise<WebAuthResult> {
  const entry = getAuthStateByToken(token);
  if (!entry) return { status: "invalid_token" };
  const { telegramId, chatId, state } = entry;

  if (state.step !== "password") return { status: "error", message: "Unexpected step" };
  if (!state.client) {
    clearState(telegramId);
    return { status: "expired" };
  }

  try {
    const srpResult = await state.client.invoke(new Api.account.GetPassword());
    const inputPassword = await computeCheck(srpResult, password);
    await state.client.invoke(
      new Api.auth.CheckPassword({ password: inputPassword })
    );

    const hint = await saveSessionFromWeb(telegramId, chatId, state);
    return { status: "success", phoneHint: hint };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("PASSWORD_HASH_INVALID")) {
      return { status: "invalid_code", message: "Неверный пароль. Попробуйте ещё раз." };
    }

    log.error(`submit2faViaWeb error for ${telegramId}: ${msg}`);
    clearState(telegramId);
    webTokens.delete(token);
    return { status: "error", message: msg };
  }
}

async function saveSessionFromWeb(
  telegramId: number,
  chatId: number,
  state: AuthFlowState
): Promise<string> {
  if (!state.client || !state.phoneNumber) throw new Error("Invalid state");

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    clearState(telegramId);
    throw new Error("User not found");
  }

  const sessionString = state.client.session.save() as unknown as string;
  const hint = phoneHint(state.phoneNumber);
  await saveUserSession(dbUser.id, sessionString, hint);

  state.client.destroy().catch(() => {});
  authStates.delete(telegramId);

  // Clean up all web tokens for this user
  for (const [t, d] of webTokens) {
    if (d.telegramId === telegramId) webTokens.delete(t);
  }

  log.info(`User ${telegramId} (db:${dbUser.id}) linked MTProto session via web (${hint})`);

  // Notify user in Telegram chat
  if (botRef) {
    botRef.telegram.sendMessage(
      chatId,
      `✅ Telegram-аккаунт привязан (${hint})!\n\n` +
      "Теперь вы можете импортировать каналы из своих папок: «📂 Импорт из папки»"
    ).catch((e) => log.error(`Failed to send chat notification: ${e}`));
  }

  return hint;
}

function getCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = parseInt(process.env.TELEGRAM_PARSER_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_PARSER_API_HASH?.trim();
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

function clearState(telegramId: number): void {
  const state = authStates.get(telegramId);
  if (state?.client) {
    state.client.destroy().catch(() => {});
  }
  authStates.delete(telegramId);
}

/** Get phone hint (last 4 digits). */
function phoneHint(phone: string): string {
  return `***${phone.slice(-4)}`;
}

/** Handle "🔑 Привязать Telegram" button press. */
export async function handleMtprotoAuthButton(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    await ctx.reply("Пользователь не найден. Отправьте /start.");
    return;
  }

  const creds = getCredentials();
  if (!creds) {
    await ctx.reply("MTProto не настроен (отсутствует TELEGRAM_PARSER_API_ID).");
    return;
  }

  // Check if already linked
  if (await hasActiveSession(dbUser.id)) {
    await ctx.reply(
      "✅ Telegram-аккаунт уже привязан.\n\n" +
      "Хотите перепривязать? Введите номер телефона (например +79001234567):"
    );
    authStates.set(telegramId, { step: "phone" });
    return;
  }

  logAction(dbUser.id, telegramId, "digest_auth_start", {});

  await ctx.reply(
    "🔑 *Привязка Telegram\\-аккаунта*\n\n" +
    "Для импорта каналов из ваших папок нужно авторизовать ваш Telegram\\-аккаунт\\.\n\n" +
    "Введите номер телефона \\(например \\+79001234567\\):",
    { parse_mode: "MarkdownV2" }
  );
  authStates.set(telegramId, { step: "phone" });
}

/**
 * Handle text input during MTProto auth flow.
 * Returns true if the message was consumed by the auth flow.
 */
export async function handleDigestAuthText(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;
  if (!ctx.message || !("text" in ctx.message)) return false;

  const state = authStates.get(telegramId);
  if (!state) return false;

  const text = ctx.message.text.trim();

  // Allow cancelling
  if (text.toLowerCase() === "отмена" || text.toLowerCase() === "cancel") {
    clearState(telegramId);
    await ctx.reply("Авторизация отменена.");
    return true;
  }

  try {
    switch (state.step) {
      case "phone":
        return await handlePhoneStep(ctx, telegramId, text, state);
      case "code":
        await ctx.reply("Введите код через веб-ссылку выше, а не в чат.");
        return true;
      case "password":
        await ctx.reply("Введите пароль 2FA через веб-ссылку выше.");
        return true;
      default:
        return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Auth flow error for user ${telegramId}: ${msg}`);
    clearState(telegramId);
    await ctx.reply(`❌ Ошибка авторизации: ${msg}\n\nПопробуйте ещё раз: «🔑 Привязать Telegram»`);
    return true;
  }
}

async function handlePhoneStep(
  ctx: Context,
  telegramId: number,
  phone: string,
  _state: AuthFlowState
): Promise<boolean> {
  // Basic phone validation
  const cleaned = phone.replace(/[\s\-()]/g, "");
  if (!/^\+?\d{10,15}$/.test(cleaned)) {
    await ctx.reply("Неверный формат номера. Введите в формате +79001234567:");
    return true;
  }

  const creds = getCredentials();
  if (!creds) {
    clearState(telegramId);
    await ctx.reply("MTProto не настроен.");
    return true;
  }

  await ctx.reply("📱 Отправляю код авторизации...");

  const session = new StringSession("");
  const client = new TelegramClient(session, creds.apiId, creds.apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  let result: Api.auth.SentCode | Api.auth.SentCodeSuccess;
  try {
    result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: cleaned,
        apiId: creds.apiId,
        apiHash: creds.apiHash,
        settings: new Api.CodeSettings({}),
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("FLOOD")) {
      const wait = msg.match(/\d+/);
      const seconds = wait ? parseInt(wait[0], 10) : 60;
      clearState(telegramId);
      await ctx.reply(`❌ Слишком много попыток. Подождите ${seconds} сек и попробуйте снова.`);
      return true;
    }
    throw err;
  }

  // GramJS may return SentCode or SentCodeSuccess; we need phoneCodeHash from SentCode
  const phoneCodeHash = "phoneCodeHash" in result ? (result as Api.auth.SentCode).phoneCodeHash : undefined;
  if (!phoneCodeHash) {
    // SentCodeSuccess — user is already authorized
    clearState(telegramId);
    await ctx.reply("Этот аккаунт уже авторизован. Попробуйте заново.");
    return true;
  }

  authStates.set(telegramId, {
    step: "code",
    phoneNumber: cleaned,
    phoneCodeHash,
    client,
  });

  // Generate web token and send link instead of asking for code in chat
  const webToken = crypto.randomBytes(32).toString("hex");
  webTokens.set(webToken, {
    token: webToken,
    telegramId,
    chatId: ctx.chat!.id,
    createdAt: Date.now(),
  });

  const baseUrl = new URL(process.env.OAUTH_REDIRECT_URI!).origin;
  const url = `${baseUrl}/auth/mtproto/${webToken}`;

  await ctx.reply(
    "📨 Код отправлен в Telegram.\n\n" +
    "Для ввода кода откройте ссылку ниже в браузере:\n\n" +
    "_(Ссылка действительна 10 минут)_",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔑 Ввести код", url }]],
      },
    }
  );
  return true;
}

/** Check if user is in the middle of auth flow. */
export function isInAuthFlow(telegramId: number): boolean {
  return authStates.has(telegramId);
}
