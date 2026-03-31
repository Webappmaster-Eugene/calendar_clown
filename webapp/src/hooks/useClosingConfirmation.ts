import { useEffect } from "react";
import { closingBehavior } from "@telegram-apps/sdk-react";

/**
 * Enable Telegram closing confirmation while this component is mounted.
 * Uses SDK v3 closingBehavior component — signal-based, no race conditions.
 *
 * Pages with forms/unsaved data should call this hook.
 * ModeSelectorPage (home screen) does NOT call it — this is critical
 * for addToHomeScreen to work without the "Changes may not be saved" dialog.
 */
export function useClosingConfirmation(): void {
  useEffect(() => {
    if (!closingBehavior.enableConfirmation.isAvailable()) return;

    closingBehavior.enableConfirmation();

    return () => {
      if (closingBehavior.disableConfirmation.isAvailable()) {
        closingBehavior.disableConfirmation();
      }
    };
  }, []);
}
