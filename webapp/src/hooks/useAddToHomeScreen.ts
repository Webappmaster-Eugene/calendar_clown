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
    // Gather diagnostic info from both SDKs.
    let sdkPlatform = "unknown";
    try {
      const lp = retrieveLaunchParams();
      sdkPlatform = String(lp.platform ?? "unknown");
    } catch {
      // Not in Telegram context.
    }

    // Fallback: read from vanilla SDK (loaded via script tag).
    const vanillaWA = (window as unknown as Record<string, unknown>).Telegram as
      { WebApp?: { platform?: string; version?: string; addToHomeScreen?: () => void } } | undefined;
    const vanillaPlatform = vanillaWA?.WebApp?.platform ?? "n/a";
    const vanillaVersion = vanillaWA?.WebApp?.version ?? "n/a";
    const vanillaHasAdd = typeof vanillaWA?.WebApp?.addToHomeScreen === "function";
    const sdkAvailable = addToHomeScreen.isAvailable();

    log(
      `sdk.platform=${sdkPlatform} vanilla.platform=${vanillaPlatform} vanilla.version=${vanillaVersion} ` +
      `sdk.addToHomeScreen.isAvailable=${sdkAvailable} vanilla.addToHomeScreen=${vanillaHasAdd}`
    );

    // Rely on SDK isAvailable() OR vanilla function existence — no manual platform filter.
    if (!sdkAvailable && !vanillaHasAdd) {
      log("unsupported: addToHomeScreen not available in either SDK");
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

    // Call addToHomeScreen — try vanilla SDK FIRST (properly connected to bridge),
    // then SDK v3 as fallback. Diagnostics showed sdk.platform=unknown but
    // vanilla.platform=android — vanilla SDK has the working bridge connection.
    let called = false;

    // 1) Vanilla SDK — proven bridge connection to Telegram native client.
    try {
      const wa = (window as unknown as Record<string, unknown>).Telegram as
        { WebApp?: { addToHomeScreen?: () => void; disableClosingConfirmation?: () => void } } | undefined;
      if (typeof wa?.WebApp?.addToHomeScreen === "function") {
        wa.WebApp.disableClosingConfirmation?.();
        wa.WebApp.addToHomeScreen();
        log("addToHomeScreen() called via vanilla SDK");
        called = true;
      }
    } catch (err) {
      log(`vanilla threw: ${err instanceof Error ? err.message : err}`);
    }

    // 2) SDK v3 fallback.
    if (!called && addToHomeScreen.isAvailable()) {
      try {
        addToHomeScreen();
        log("addToHomeScreen() called via SDK v3");
        called = true;
      } catch (err) {
        log(`SDK v3 threw: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (!called) {
      log("neither SDK could call addToHomeScreen");
    }

    if (!called) {
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
