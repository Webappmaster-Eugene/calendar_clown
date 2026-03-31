import { useEffect } from "react";

/** Enable Telegram closing confirmation while this component is mounted. */
export function useClosingConfirmation(): void {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    webApp.enableClosingConfirmation?.();

    return () => {
      webApp.disableClosingConfirmation?.();
    };
  }, []);
}
