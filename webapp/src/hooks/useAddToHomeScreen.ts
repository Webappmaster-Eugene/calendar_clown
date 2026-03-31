/**
 * Hook for "Add to Home Screen" functionality.
 *
 * Uses @telegram-apps/sdk v3:
 * - addToHomeScreen / checkHomeScreenStatus — utility functions
 * - onAddedToHomeScreen / onAddToHomeScreenFailed — event listeners
 * - closingBehavior — signal-based state for confirmation toggle
 *
 * State machine:
 *   unsupported → (feature unavailable)
 *   unknown     → (initial, checking status)
 *   idle        → (available, button visible)
 *   adding      → (prompt shown, waiting for user)
 *   added       → (success, button hidden)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  addToHomeScreen,
  checkHomeScreenStatus,
  onAddedToHomeScreen,
  offAddedToHomeScreen,
  onAddToHomeScreenFailed,
  offAddToHomeScreenFailed,
  closingBehavior,
  hapticFeedback,
  retrieveLaunchParams,
} from "@telegram-apps/sdk-react";

type HomeScreenStatus = "unsupported" | "unknown" | "idle" | "adding" | "added";

const FALLBACK_TIMEOUT_MS = 5_000;

/** Platforms where home screen shortcuts are meaningful. */
const MOBILE_PLATFORMS = new Set(["android", "android_x", "ios"]);

interface UseAddToHomeScreenResult {
  status: HomeScreenStatus;
  /** true when the button should be visible (status === "idle") */
  canShow: boolean;
  /** true while the prompt is active (status === "adding") */
  isAdding: boolean;
  /** Call to initiate the add-to-home-screen flow */
  trigger: () => void;
  /** Diagnostic log entries for debugging */
  diagnostics: string[];
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function useAddToHomeScreen(): UseAddToHomeScreenResult {
  const [status, setStatus] = useState<HomeScreenStatus>("unknown");
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wasConfirmationEnabledRef = useRef(false);

  const log = useCallback((msg: string) => {
    const entry = `[${ts()}] ${msg}`;
    console.log("[home-screen]", msg);
    setDiagnostics((prev) => [...prev.slice(-49), entry]);
  }, []);

  // ── Capability check + initial status ──
  useEffect(() => {
    // Check platform first.
    let platform = "unknown";
    try {
      const lp = retrieveLaunchParams();
      platform = String(lp.platform ?? "unknown");
    } catch {
      // Not in Telegram context.
    }

    log(`platform=${platform} addToHomeScreen.isAvailable=${addToHomeScreen.isAvailable()}`);

    if (!MOBILE_PLATFORMS.has(platform)) {
      log("unsupported: not a mobile platform");
      setStatus("unsupported");
      return;
    }

    if (!addToHomeScreen.isAvailable()) {
      log("unsupported: addToHomeScreen not available");
      setStatus("unsupported");
      return;
    }

    // Check if already added.
    if (checkHomeScreenStatus.isAvailable()) {
      log("checking home screen status...");
      checkHomeScreenStatus()
        .then((result) => {
          log(`checkHomeScreenStatus → "${result}"`);
          if (result === "added") {
            setStatus("added");
          } else {
            // "unknown", "missed", or anything else → show the button.
            setStatus("idle");
          }
        })
        .catch((err) => {
          log(`checkHomeScreenStatus error: ${err}`);
          // On error, optimistically show the button.
          setStatus("idle");
        });
    } else {
      log("checkHomeScreenStatus not available, defaulting to idle");
      setStatus("idle");
    }

    // ── Event listeners ──
    const handleAdded = () => {
      log("event: homeScreenAdded");
      setStatus("added");
      clearTimeout(timeoutRef.current);
      restoreClosingConfirmation();
    };

    const handleFailed = () => {
      log("event: homeScreenFailed (user declined)");
      setStatus("idle");
      clearTimeout(timeoutRef.current);
      restoreClosingConfirmation();
    };

    onAddedToHomeScreen(handleAdded);
    onAddToHomeScreenFailed(handleFailed);

    return () => {
      offAddedToHomeScreen(handleAdded);
      offAddToHomeScreenFailed(handleFailed);
      clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreClosingConfirmation = useCallback(() => {
    if (wasConfirmationEnabledRef.current) {
      if (closingBehavior.enableConfirmation.isAvailable()) {
        closingBehavior.enableConfirmation();
        log("restored closing confirmation");
      }
      wasConfirmationEnabledRef.current = false;
    }
  }, [log]);

  // ── Trigger the add-to-home-screen flow ──
  const trigger = useCallback(() => {
    if (!addToHomeScreen.isAvailable()) {
      log("trigger: addToHomeScreen not available");
      return;
    }
    if (status === "adding" || status === "added") {
      log(`trigger: skipped (status=${status})`);
      return;
    }

    setStatus("adding");

    // Haptic feedback.
    hapticFeedback.impactOccurred.ifAvailable("light");

    // Read closing confirmation state synchronously via signal.
    let confirmationEnabled = false;
    try {
      confirmationEnabled = closingBehavior.isConfirmationEnabled();
    } catch {
      // Signal not mounted — confirmation is off.
    }
    log(`closingBehavior.isConfirmationEnabled=${confirmationEnabled}`);

    // If enabled, disable it before calling addToHomeScreen.
    if (confirmationEnabled) {
      wasConfirmationEnabledRef.current = true;
      if (closingBehavior.disableConfirmation.isAvailable()) {
        closingBehavior.disableConfirmation();
        log("disabled closing confirmation");
      }
    }

    // Call addToHomeScreen — SDK handles bridge serialization.
    try {
      addToHomeScreen();
      log("addToHomeScreen() called");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`addToHomeScreen() threw: ${msg}`);
      setStatus("idle");
      restoreClosingConfirmation();
      return;
    }

    // Fallback timeout — SDK docs: "the event may not be received even if the icon has been added."
    timeoutRef.current = setTimeout(() => {
      log(`timeout: no event received in ${FALLBACK_TIMEOUT_MS}ms`);
      setStatus("idle");
      restoreClosingConfirmation();
    }, FALLBACK_TIMEOUT_MS);
  }, [status, log, restoreClosingConfirmation]);

  return {
    status,
    canShow: status === "idle",
    isAdding: status === "adding",
    trigger,
    diagnostics,
  };
}
