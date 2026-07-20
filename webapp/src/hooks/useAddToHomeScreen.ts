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

export type HomeScreenStatus = "unsupported" | "unknown" | "idle" | "adding" | "added" | "failed";

const FALLBACK_TIMEOUT_MS = 5_000;

interface UseAddToHomeScreenResult {
  status: HomeScreenStatus;
  canShow: boolean;
  isAdding: boolean;
  showResult: boolean;
  trigger: () => void;
  retry: () => void;
  dismiss: () => void;
  diagnostics: string[];
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function getVanillaWebApp(): {
  platform?: string;
  version?: string;
  addToHomeScreen?: () => void;
  disableClosingConfirmation?: () => void;
} | undefined {
  try {
    return (window as unknown as Record<string, unknown>).Telegram as
      { WebApp?: Record<string, unknown> } | undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((window as any).Telegram.WebApp as Record<string, unknown>) as any
      : undefined;
  } catch {
    return undefined;
  }
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
    let sdkPlatform = "unknown";
    try {
      const lp = retrieveLaunchParams();
      sdkPlatform = String(lp.platform ?? "unknown");
    } catch { /* dev mode */ }

    const vanilla = getVanillaWebApp();
    const sdkAvailable = addToHomeScreen.isAvailable();
    const vanillaHasAdd = typeof vanilla?.addToHomeScreen === "function";

    log(
      `platform=${vanilla?.platform ?? sdkPlatform} version=${vanilla?.version ?? "?"} ` +
      `sdk=${sdkAvailable} vanilla=${vanillaHasAdd}`
    );

    if (!sdkAvailable && !vanillaHasAdd) {
      log("unsupported");
      setStatus("unsupported");
      return;
    }

    if (checkHomeScreenStatus.isAvailable()) {
      checkHomeScreenStatus()
        .then((result) => {
          log(`checkStatus="${result}"`);
          setStatus(result === "added" ? "added" : "idle");
        })
        .catch(() => setStatus("idle"));
    } else {
      setStatus("idle");
    }

    // Event listeners (guarded — these throw outside Mini Apps).
    const handleAdded = () => {
      log("event: added");
      setStatus("added");
      clearTimeout(timeoutRef.current);
      restoreClosingConfirmation();
    };

    const handleFailed = () => {
      log("event: failed (user declined)");
      setStatus("idle");
      clearTimeout(timeoutRef.current);
      restoreClosingConfirmation();
    };

    let listenersBound = false;
    try {
      onAddedToHomeScreen(handleAdded);
      onAddToHomeScreenFailed(handleFailed);
      listenersBound = true;
    } catch {
      log("event listeners not available");
    }

    return () => {
      if (listenersBound) {
        try {
          offAddedToHomeScreen(handleAdded);
          offAddToHomeScreenFailed(handleFailed);
        } catch { /* cleanup best-effort */ }
      }
      clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreClosingConfirmation = useCallback(() => {
    if (wasConfirmationEnabledRef.current) {
      closingBehavior.enableConfirmation.ifAvailable();
      wasConfirmationEnabledRef.current = false;
    }
  }, []);

  // ── Trigger ──
  const trigger = useCallback(() => {
    if (status === "adding" || status === "added") return;

    setStatus("adding");
    hapticFeedback.impactOccurred.ifAvailable("light");

    let confirmationEnabled = false;
    try { confirmationEnabled = closingBehavior.isConfirmationEnabled(); } catch { /* ignore */ }
    if (confirmationEnabled) {
      wasConfirmationEnabledRef.current = true;
      closingBehavior.disableConfirmation.ifAvailable();
    }

    let called = false;
    const vanilla = getVanillaWebApp();
    if (typeof vanilla?.addToHomeScreen === "function") {
      try {
        vanilla.disableClosingConfirmation?.();
        vanilla.addToHomeScreen();
        log("called via vanilla");
        called = true;
      } catch (err) {
        log(`vanilla error: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (!called && addToHomeScreen.isAvailable()) {
      try {
        addToHomeScreen();
        log("called via sdk");
        called = true;
      } catch (err) {
        log(`sdk error: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (!called) {
      log("no method available");
      setStatus("failed");
      restoreClosingConfirmation();
      return;
    }

    // failed (not idle) so the failure UI shows when the prompt never responds
    timeoutRef.current = setTimeout(() => {
      log("timeout: no response");
      setStatus("failed");
      restoreClosingConfirmation();
    }, FALLBACK_TIMEOUT_MS);
  }, [status, log, restoreClosingConfirmation]);

  const retry = useCallback(() => {
    setStatus("idle");
  }, []);

  const dismiss = useCallback(() => {
    setStatus("unsupported"); // reuse "unsupported" to hide all UI after success is acknowledged
  }, []);

  return {
    status,
    canShow: status === "idle" || status === "failed",
    isAdding: status === "adding",
    showResult: status === "added" || status === "failed",
    trigger,
    retry,
    dismiss,
    diagnostics,
  };
}
