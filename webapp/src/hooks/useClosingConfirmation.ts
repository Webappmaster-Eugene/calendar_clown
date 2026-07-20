import { useEffect } from "react";
import { closingBehavior } from "@telegram-apps/sdk-react";

// Enables Telegram's closing confirmation while mounted. ModeSelectorPage (home
// screen) must NOT call it, or addToHomeScreen triggers a "Changes may not be
// saved" dialog.
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
