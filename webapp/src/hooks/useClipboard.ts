/**
 * Copy-to-clipboard hook with SDK-aware fallback chain and haptic feedback.
 *
 * Order of attempts (first to succeed wins):
 *   1. navigator.clipboard.writeText — standard web API, supported by
 *      Telegram WebViews on iOS ≥ 13.1 and recent Android builds.
 *   2. Legacy hidden-textarea + document.execCommand("copy") — old WebViews.
 */
import { useCallback, useRef, useState } from "react";
import { useHaptic } from "./useHaptic";
import { useToast } from "../components/ui/ToastProvider";

export interface UseClipboardOptions {
  resetMs?: number;
  successMessage?: string;
  errorMessage?: string;
}

export interface UseClipboardResult {
  copy: (text: string, opts?: { silent?: boolean }) => Promise<boolean>;
  isCopied: boolean;
}

export function useClipboard(opts?: UseClipboardOptions): UseClipboardResult {
  const {
    resetMs = 1800,
    successMessage = "Скопировано",
    errorMessage = "Не удалось скопировать",
  } = opts ?? {};
  const { notification } = useHaptic();
  const toast = useToast();
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string, { silent = false }: { silent?: boolean } = {}) => {
      if (!text) return false;

      let success = false;
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          success = true;
        }
      } catch {
        /* fall through to legacy path */
      }

      if (!success) {
        success = legacyCopy(text);
      }

      if (success && !silent) {
        notification("success");
        toast.show({ description: successMessage, variant: "success" });
        setIsCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setIsCopied(false), resetMs);
      } else if (!success && !silent) {
        notification("error");
        toast.show({ description: errorMessage, variant: "error" });
      }
      return success;
    },
    [notification, resetMs, successMessage, errorMessage, toast],
  );

  return { copy, isCopied };
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
