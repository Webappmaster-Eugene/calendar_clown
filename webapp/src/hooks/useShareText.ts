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

      try {
        if (typeof openTelegramLink === "function" && openTelegramLink.isAvailable?.()) {
          // t.me/share/url needs a URL field, so pass an empty token there and
          // the whole payload as `text`; Telegram then opens a message composer
          // pre-filled with the text.
          const url = `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encodeURIComponent(trimmed)}`;
          openTelegramLink(url);
          return "telegramShare";
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
