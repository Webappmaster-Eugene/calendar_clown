/**
 * Telegram Mini Apps SDK v3 initialization.
 *
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

/** Whether the SDK initialized successfully (false in dev mode / outside Telegram). */
let sdkReady = false;

export function initTelegramSdk(): boolean {
  try {
    // Base SDK init — sets up bridge communication.
    init();

    // Mount stateful components so their signals are available.
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

    // Signal that the Mini App is ready to be displayed.
    if (miniApp.ready.isAvailable()) {
      miniApp.ready();
    }

    // Set header color to match secondary background.
    if (miniApp.setHeaderColor.isAvailable()) {
      miniApp.setHeaderColor("secondary_bg_color");
    }

    // Initialize API client with auth data (initDataRaw for Authorization header).
    try {
      const raw = retrieveRawInitData();
      if (raw) {
        setInitData(raw);
      }
    } catch {
      // retrieveRawInitData may throw if not in Telegram context — handled below.
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
