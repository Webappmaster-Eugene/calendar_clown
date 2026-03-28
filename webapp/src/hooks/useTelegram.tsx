/**
 * Telegram WebApp SDK integration.
 * Provides initDataRaw for API auth and theme/platform helpers.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setInitData } from "../api/client";

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    auth_date: number;
    hash: string;
  };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  expand: () => void;
  close: () => void;
  ready: () => void;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    setParams: (params: Record<string, unknown>) => void;
  };
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
  platform: string;
  version: string;
  // Bot API 8.0+ — home screen support
  addToHomeScreen?: () => void;
  checkHomeScreenStatus?: (callback: (status: "unsupported" | "unknown" | "added" | "missed") => void) => void;
  // SDK v7.7+ — swipe & closing behavior
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  // SDK v6.1+ — header/background color
  setHeaderColor?: (color: "bg_color" | "secondary_bg_color" | string) => void;
  setBackgroundColor?: (color: string) => void;
  // Event system
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

interface TelegramContextValue {
  webApp: TelegramWebApp | null;
  initDataRaw: string;
  user: TelegramWebApp["initDataUnsafe"]["user"] | null;
  colorScheme: "light" | "dark";
  isReady: boolean;
}

const TelegramContext = createContext<TelegramContextValue>({
  webApp: null,
  initDataRaw: "",
  user: null,
  colorScheme: "light",
  isReady: false,
});

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TelegramContextValue>({
    webApp: null,
    initDataRaw: "",
    user: null,
    colorScheme: "light",
    isReady: false,
  });

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      // Dev mode: no Telegram SDK available
      console.warn("Telegram WebApp SDK not available. Running in dev mode.");
      setCtx({
        webApp: null,
        initDataRaw: "",
        user: null,
        colorScheme: "light",
        isReady: true,
      });
      return;
    }

    // Expand viewport & configure native behavior
    webApp.expand();
    webApp.ready();
    webApp.disableVerticalSwipes?.();
    webApp.enableClosingConfirmation?.();
    webApp.setHeaderColor?.("secondary_bg_color");

    // Initialize API client with auth data
    setInitData(webApp.initData);

    setCtx({
      webApp,
      initDataRaw: webApp.initData,
      user: webApp.initDataUnsafe.user ?? null,
      colorScheme: webApp.colorScheme,
      isReady: true,
    });
  }, []);

  return (
    <TelegramContext.Provider value={ctx}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegram(): TelegramContextValue {
  return useContext(TelegramContext);
}
