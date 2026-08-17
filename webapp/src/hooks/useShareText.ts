import { useCallback } from "react";
import { openTelegramLink } from "@telegram-apps/sdk-react";
import { useClipboard } from "./useClipboard";

export type ShareMethod = "telegramLink" | "webShare" | "clipboard";

export interface UseShareTextResult {
  share: (text: string) => Promise<ShareMethod | null>;
}

// t.me/share/url carries the whole payload in a query string, and Cyrillic
// percent-encodes to 6 bytes per character — past this the link silently gets
// truncated or ignored by Telegram, so longer texts take another route.
const TELEGRAM_LINK_MAX_ENCODED = 1500;

export function useShareText(): UseShareTextResult {
  const { copy } = useClipboard({ successMessage: "Скопировано — вставьте в чат" });

  const share = useCallback(
    async (text: string): Promise<ShareMethod | null> => {
      const trimmed = text?.trim();
      if (!trimmed) return null;

      const encoded = encodeURIComponent(trimmed);
      try {
        if (
          encoded.length <= TELEGRAM_LINK_MAX_ENCODED &&
          typeof openTelegramLink === "function" &&
          openTelegramLink.isAvailable?.()
        ) {
          // The url field is required, so it gets a single encoded space and the
          // payload travels in `text`; Telegram then opens a message composer.
          const url = `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encoded}`;
          openTelegramLink(url);
          return "telegramLink";
        }
      } catch {
        /* fall through */
      }

      try {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          await navigator.share({ text: trimmed });
          return "webShare";
        }
      } catch {
        /* fall through */
      }

      const copied = await copy(trimmed);
      return copied ? "clipboard" : null;
    },
    [copy],
  );

  return { share };
}
