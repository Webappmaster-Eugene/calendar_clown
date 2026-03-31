/**
 * Telegram Mini Apps SDK v3 integration.
 * Provides user data, initDataRaw for API auth, and utility wrappers.
 *
 * SDK initialization (init, mount, expand, ready) happens in ../init.ts
 * BEFORE React renders. This hook only reads launch params and provides
 * convenience wrappers for popup/link APIs.
 */
import { createContext, useContext, useEffect, useCallback, type ReactNode } from "react";
import {
  openPopup,
  openLink as sdkOpenLink,
  retrieveRawInitData,
  retrieveLaunchParams,
  initDataUser,
  isMiniAppDark,
} from "@telegram-apps/sdk-react";
import { setInitData } from "../api/client";
import { isSdkReady } from "../init";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramContextValue {
  initDataRaw: string;
  user: TelegramUser | null;
  colorScheme: "light" | "dark";
  platform: string;
  isReady: boolean;
  /** Show a simple alert popup. */
  showAlert: (message: string, callback?: () => void) => void;
  /** Show a confirmation popup with OK/Cancel buttons. */
  showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
  /** Open an external URL. */
  openLink: (url: string) => void;
}

// ── Helpers to extract user and launch data ──

function extractTelegramData(): {
  initDataRaw: string;
  user: TelegramUser | null;
  colorScheme: "light" | "dark";
  platform: string;
} {
  if (!isSdkReady()) {
    return { initDataRaw: "", user: null, colorScheme: "light", platform: "unknown" };
  }

  let initDataRawStr = "";
  try {
    initDataRawStr = retrieveRawInitData() ?? "";
  } catch {
    // Not in Telegram context.
  }

  let user: TelegramUser | null = null;
  let platform = "unknown";
  try {
    const lp = retrieveLaunchParams();
    platform = String(lp.platform ?? "unknown");
  } catch {
    // Not in Telegram context.
  }

  try {
    const u = initDataUser();
    if (u) {
      user = {
        id: u.id,
        first_name: u.first_name ?? "",
        last_name: u.last_name,
        username: u.username,
        language_code: u.language_code,
      };
    }
  } catch {
    // initDataUser signal not ready.
  }

  let colorScheme: "light" | "dark" = "light";
  try {
    colorScheme = isMiniAppDark() ? "dark" : "light";
  } catch {
    // Signal not ready.
  }

  return { initDataRaw: initDataRawStr, user, colorScheme, platform };
}

// ── Context ──

const defaultCtx: TelegramContextValue = {
  initDataRaw: "",
  user: null,
  colorScheme: "light",
  platform: "unknown",
  isReady: false,
  showAlert: () => {},
  showConfirm: () => {},
  openLink: () => {},
};

const TelegramContext = createContext<TelegramContextValue>(defaultCtx);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const data = extractTelegramData();

  // Stable wrappers for popup/link APIs.
  const showAlert = useCallback((message: string, callback?: () => void) => {
    if (openPopup.isAvailable()) {
      openPopup({ message, buttons: [{ type: "ok", id: "ok" }] })
        .then(() => callback?.())
        .catch(() => callback?.());
    } else {
      window.alert(message);
      callback?.();
    }
  }, []);

  const showConfirm = useCallback((message: string, callback: (confirmed: boolean) => void) => {
    if (openPopup.isAvailable()) {
      openPopup({ message, buttons: [{ type: "ok", id: "ok" }, { type: "cancel", id: "cancel" }] })
        .then((id) => callback(id === "ok"))
        .catch(() => callback(false));
    } else {
      callback(window.confirm(message));
    }
  }, []);

  const openLink = useCallback((url: string) => {
    if (sdkOpenLink.isAvailable()) {
      sdkOpenLink(url);
    } else {
      window.open(url, "_blank");
    }
  }, []);

  // Ensure API client has initData.
  useEffect(() => {
    if (data.initDataRaw) {
      setInitData(data.initDataRaw);
    }
  }, [data.initDataRaw]);

  const ctx: TelegramContextValue = {
    ...data,
    isReady: true,
    showAlert,
    showConfirm,
    openLink,
  };

  return (
    <TelegramContext.Provider value={ctx}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegram(): TelegramContextValue {
  return useContext(TelegramContext);
}
