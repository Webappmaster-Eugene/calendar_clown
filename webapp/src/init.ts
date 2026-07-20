/**
 * Must be called BEFORE React's createRoot() so that SDK components
 * (closingBehavior, backButton, viewport, swipeBehavior) are mounted
 * and ready when the first React component renders.
 */
import {
  init,
  backButton,
  closingBehavior,
  swipeBehavior,
  viewport,
  miniApp,
  retrieveRawInitData,
} from "@telegram-apps/sdk-react";
import { setInitData } from "./api/client";

let sdkReady = false;

export function initTelegramSdk(): boolean {
  try {
    init();

    if (closingBehavior.mount.isAvailable()) {
      closingBehavior.mount();
    }
    if (backButton.mount.isAvailable()) {
      backButton.mount();
    }
    // Viewport mount is async — fire and forget, expand when ready.
    if (viewport.mount.isAvailable()) {
      viewport.mount()
        .then(() => {
          if (viewport.expand.isAvailable()) viewport.expand();
        })
        .catch((err) => {
          console.warn("[init] viewport.mount failed:", err);
        });
    }
    if (swipeBehavior.mount.isAvailable()) {
      swipeBehavior.mount();
      if (swipeBehavior.disableVertical.isAvailable()) {
        swipeBehavior.disableVertical();
      }
    }

    if (miniApp.ready.isAvailable()) {
      miniApp.ready();
    }

    if (miniApp.setHeaderColor.isAvailable()) {
      miniApp.setHeaderColor("secondary_bg_color");
    }

    try {
      const raw = retrieveRawInitData();
      if (raw) {
        setInitData(raw);
      }
    } catch {
      // retrieveRawInitData may throw if not in Telegram context.
    }

    sdkReady = true;
    return true;
  } catch (err) {
    console.warn("[init] Telegram SDK init failed (dev mode?):", err);
    sdkReady = false;
    return false;
  }
}

export function isSdkReady(): boolean {
  return sdkReady;
}
