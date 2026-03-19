/**
 * MTProto auth flow for per-user Telegram session.
 * Allows users to link their Telegram account for folder import.
 *
 * Flow: phone → code → (optional 2FA) → session saved.
 */

import type { Context } from "telegraf";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { computeCheck } from "telegram/Password.js";
import { saveUserSession, hasActiveSession } from "../digest/sessionManager.js";
import { getUserByTelegramId } from "../expenses/repository.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("digest-auth");

type AuthStep = "phone" | "code" | "password";

interface AuthFlowState {
  step: AuthStep;
  phoneNumber?: string;
  phoneCodeHash?: string;
  client?: TelegramClient;
}

const authStates = new Map<number, AuthFlowState>();

function getCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = parseInt(process.env.TELEGRAM_PARSER_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_PARSER_API_HASH?.trim();
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

function clearState(telegramId: number): void {
  const state = authStates.get(telegramId);
  if (state?.client) {
    state.client.disconnect().catch(() => {});
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
        return await handleCodeStep(ctx, telegramId, text, state);
      case "password":
        return await handlePasswordStep(ctx, telegramId, text, state);
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

  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: cleaned,
      apiId: creds.apiId,
      apiHash: creds.apiHash,
      settings: new Api.CodeSettings({}),
    })
  );

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

  await ctx.reply(
    "📨 Код отправлен в Telegram. Введите код авторизации:\n\n" +
    "_(Введите «отмена» для отмены)_",
    { parse_mode: "Markdown" }
  );
  return true;
}

async function handleCodeStep(
  ctx: Context,
  telegramId: number,
  code: string,
  state: AuthFlowState
): Promise<boolean> {
  if (!state.client || !state.phoneNumber || !state.phoneCodeHash) {
    clearState(telegramId);
    await ctx.reply("Сессия авторизации истекла. Начните заново.");
    return true;
  }

  // Remove spaces/dashes from code
  const cleanCode = code.replace(/[\s\-]/g, "");
  if (!/^\d{4,8}$/.test(cleanCode)) {
    await ctx.reply("Введите числовой код (4-8 цифр):");
    return true;
  }

  try {
    await state.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: state.phoneNumber,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: cleanCode,
      })
    );

    // Success — save session
    await saveSessionAndFinish(ctx, telegramId, state);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      authStates.set(telegramId, {
        ...state,
        step: "password",
      });
      await ctx.reply(
        "🔐 Требуется пароль двухфакторной аутентификации.\nВведите пароль 2FA:"
      );
      return true;
    }

    if (msg.includes("PHONE_CODE_INVALID")) {
      await ctx.reply("❌ Неверный код. Попробуйте ещё раз:");
      return true;
    }

    if (msg.includes("PHONE_CODE_EXPIRED")) {
      clearState(telegramId);
      await ctx.reply("❌ Код истёк. Начните заново: «🔑 Привязать Telegram»");
      return true;
    }

    throw err;
  }
}

async function handlePasswordStep(
  ctx: Context,
  telegramId: number,
  password: string,
  state: AuthFlowState
): Promise<boolean> {
  if (!state.client) {
    clearState(telegramId);
    await ctx.reply("Сессия авторизации истекла. Начните заново.");
    return true;
  }

  try {
    const srpResult = await state.client.invoke(new Api.account.GetPassword());

    const inputPassword = await computeCheck(srpResult, password);
    await state.client.invoke(
      new Api.auth.CheckPassword({ password: inputPassword })
    );

    await saveSessionAndFinish(ctx, telegramId, state);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("PASSWORD_HASH_INVALID")) {
      await ctx.reply("❌ Неверный пароль. Попробуйте ещё раз:");
      return true;
    }

    throw err;
  }
}

async function saveSessionAndFinish(
  ctx: Context,
  telegramId: number,
  state: AuthFlowState
): Promise<void> {
  if (!state.client || !state.phoneNumber) return;

  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    clearState(telegramId);
    return;
  }

  const sessionString = state.client.session.save() as unknown as string;
  const hint = phoneHint(state.phoneNumber);

  await saveUserSession(dbUser.id, sessionString, hint);

  // Disconnect the auth client (session manager will create a new one when needed)
  state.client.disconnect().catch(() => {});
  authStates.delete(telegramId);

  log.info(`User ${telegramId} (db:${dbUser.id}) linked MTProto session (${hint})`);
  await ctx.reply(
    `✅ Telegram-аккаунт привязан (${hint})!\n\n` +
    "Теперь вы можете импортировать каналы из своих папок: «📂 Импорт из папки»"
  );
}

/** Check if user is in the middle of auth flow. */
export function isInAuthFlow(telegramId: number): boolean {
  return authStates.has(telegramId);
}
