import { useCallback, useState } from "react";
import { shareMessage } from "@telegram-apps/sdk-react";
import { api } from "../api/client";
import { useHaptic } from "./useHaptic";
import { useToast } from "../components/ui/ToastProvider";
import { useShareText } from "./useShareText";
import type { PreparedShareDto } from "@shared/types";

export type ShareOutcome = "prepared" | "telegramLink" | "webShare" | "clipboard" | "failed";

export interface UseShareMessageResult {
  shareChatMessage: (args: {
    dialogId: number;
    messageId: number;
    fallbackText: string;
  }) => Promise<ShareOutcome>;
  isSharing: boolean;
}

/** Shares one saved assistant answer through Telegram's native chat picker
 *  (Bot API 8.0 prepared inline message), falling back to link/clipboard sharing on
 *  older clients. A prepared id is single-use, so a fresh one is fetched per tap. */
export function useShareMessage(): UseShareMessageResult {
  const { notification } = useHaptic();
  const toast = useToast();
  const { share: shareFallback } = useShareText();
  const [isSharing, setIsSharing] = useState(false);

  const shareChatMessage = useCallback(
    async ({
      dialogId,
      messageId,
      fallbackText,
    }: {
      dialogId: number;
      messageId: number;
      fallbackText: string;
    }): Promise<ShareOutcome> => {
      setIsSharing(true);
      try {
        const canPrepare =
          typeof shareMessage === "function" && shareMessage.isAvailable?.();

        if (canPrepare) {
          try {
            const prepared = await api.post<PreparedShareDto>("/api/chat/share", {
              dialogId,
              messageId,
            });
            await shareMessage(prepared.preparedMessageId);
            notification("success");
            toast.show({ description: "Открываю выбор чата…", variant: "info" });
            if (prepared.truncated) {
              toast.show({
                description: "Ответ длиннее 4096 символов — отправлен сокращённый текст",
                variant: "warning",
              });
            }
            return "prepared";
          } catch (err) {
            // Dismissing the chat picker rejects too — don't shout about it, just
            // fall through to the older sharing paths.
            const message = err instanceof Error ? err.message : "";
            if (message) console.warn("[share] prepared message failed:", message);
          }
        }

        const method = await shareFallback(fallbackText);
        if (method === null) {
          notification("error");
          toast.show({ description: "Не удалось поделиться", variant: "error" });
          return "failed";
        }
        return method;
      } finally {
        setIsSharing(false);
      }
    },
    [notification, shareFallback, toast],
  );

  return { shareChatMessage, isSharing };
}
