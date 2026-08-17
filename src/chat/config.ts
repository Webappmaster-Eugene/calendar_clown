import {
  DEEPSEEK_MODEL,
  DEEPSEEK_FREE_MODEL,
  NEURO_UNCENSORED_MODEL,
  NEURO_VISION_MODEL,
  CHAT_MESSAGE_LIMIT,
} from "../constants.js";
import type { ChatProvider } from "../shared/types.js";

// Single source of truth for neuro-chat AI config, shared by the bot commands and
// the Mini App API. Imports neither db/* nor telegraf, so both layers (and unit
// tests) can depend on it without pulling the other side's dependencies in.

/** The per-dialog overrides both clients store on chat_dialogs. */
export interface DialogAiOverrides {
  model: string | null;
  systemPrompt: string | null;
}

export interface DialogAiConfig {
  model: string;
  /** Per-dialog role, composed onto the base rules by composeSystemPrompt. */
  persona?: string | null;
  uncensored: boolean;
}

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
  free: "🆓 Free",
  paid: "💎 Paid",
  uncensored: "🔥 Без цензуры",
};

export const CHAT_LIMIT_REACHED_MSG =
  `Диалог достиг лимита в ${CHAT_MESSAGE_LIMIT} сообщений. Начните новый чат.`;

export function resolveProviderDefaults(provider: ChatProvider): { model: string; uncensored: boolean } {
  switch (provider) {
    case "free": return { model: DEEPSEEK_FREE_MODEL, uncensored: false };
    case "paid": return { model: DEEPSEEK_MODEL, uncensored: false };
    case "uncensored": return { model: NEURO_UNCENSORED_MODEL, uncensored: true };
  }
}

export function resolveDialogAiConfig(
  dialog: DialogAiOverrides,
  provider: ChatProvider
): DialogAiConfig {
  const base = resolveProviderDefaults(provider);
  return {
    model: dialog.model || base.model,
    persona: dialog.systemPrompt,
    uncensored: base.uncensored,
  };
}

export function formatProviderDescription(provider: ChatProvider): string {
  const { model } = resolveProviderDefaults(provider);
  switch (provider) {
    case "free":
      return `🆓 *Free* — быстрая модель по умолчанию (\`${model}\`), лимиты провайдера`;
    case "paid":
      return `💎 *Paid* — \`${model}\` (платная, без rate-limit)`;
    case "uncensored":
      return `🔥 *Без цензуры* — \`${model}\` (без ограничений контента)`;
  }
}

/** Markdown block describing what the dialog will actually use — reused by the
 *  /neuro banner, the provider-switch reply and the settings panel so they can't drift. */
export function formatEffectiveConfig(
  dialog: DialogAiOverrides | null,
  provider: ChatProvider,
  messageCount?: number
): string {
  const providerLabel = PROVIDER_LABELS[provider];
  const lines: string[] = [];

  if (!dialog) {
    const { model } = resolveProviderDefaults(provider);
    lines.push(`🤖 Модель: \`${model}\` (${providerLabel} — по умолчанию)`);
    lines.push("📝 Промпт: базовый");
    lines.push("_Диалог ещё не начат — отправьте сообщение._");
    return lines.join("\n");
  }

  const { model } = resolveDialogAiConfig(dialog, provider);
  lines.push(
    dialog.model
      ? `🤖 Модель: \`${model}\` (задана для диалога)`
      : `🤖 Модель: \`${model}\` (${providerLabel} — по умолчанию)`
  );
  lines.push(
    dialog.systemPrompt
      ? `📝 Промпт: свой (${dialog.systemPrompt.length} симв.)`
      : "📝 Промпт: базовый"
  );
  lines.push(`🖼 Фото и документы: \`${NEURO_VISION_MODEL}\` (vision)`);
  if (messageCount != null) {
    lines.push(`💬 Сообщений: ${messageCount} из ${CHAT_MESSAGE_LIMIT}`);
  }
  return lines.join("\n");
}
