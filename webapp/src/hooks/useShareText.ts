/**
 * Share-text hook — opens Telegram's native share sheet when possible, or
 * falls back to clipboard copy.
 *
 * Order of preference:
 *   1. openTelegramLink('https://t.me/share/url?url=&text=…') via the
 *      @telegram-apps/sdk-react function. This opens Telegram's native
 *      "send to contact" sheet inside the Mini App.
 *   2. navigator.share (web fallback when testing in a browser).
 *   3. useClipboard — always available as a last resort.
 */
import { useCallback } from "react";
import { openTelegramLink } from "@telegram-apps/sdk-react";
import { useClipboard } from "./useClipboard";

export type ShareMethod = "telegramShare" | "webShare" | "clipboard";

export interface UseShareTextResult {
  share: (text: string) => Promise<ShareMethod | null>;
}

export function useShareText(): UseShareTextResult {
  const { copy } = useClipboard();

  const share = useCallback(
    async (text: string): Promise<ShareMethod | null> => {
      const trimmed = text?.trim();
      if (!trimmed) return null;

      // Try Telegram's native share sheet.
      try {
        if (typeof openTelegramLink === "function" && openTelegramLink.isAvailable?.()) {
          // t.me/share/url expects a URL + optional text. We put an empty
          // URL token and the entire payload into `text`. Telegram will
          // strip the URL field and show a message composer pre-filled
          // with the text.
          const url = `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encodeURIComponent(trimmed)}`;
          openTelegramLink(url);
          return "telegramShare";
        }
      } catch {
        /* fall through */
      }

      // Web share API (available in dev/browser testing).
      try {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          await navigator.share({ text: trimmed });
          return "webShare";
        }
      } catch {
        /* fall through */
      }

      // Final fallback — copy to clipboard.
      const copied = await copy(trimmed);
      return copied ? "clipboard" : null;
    },
    [copy],
  );

  return { share };
}
