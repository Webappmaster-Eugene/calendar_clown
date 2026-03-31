import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useHaptic } from "../hooks/useHaptic";
import type { UserProfile } from "@shared/types";
import { MODE_LABELS } from "@shared/constants";

interface UserProfileWithModes extends UserProfile {
  availableModes: string[];
}

const MODE_ROUTES: Record<string, string> = {
  calendar: "/calendar",
  expenses: "/expenses",
  gandalf: "/gandalf",
  goals: "/goals",
  reminders: "/reminders",
  wishlist: "/wishlist",
  notable_dates: "/dates",
  digest: "/digest",
  osint: "/osint",
  neuro: "/neuro",
  transcribe: "/transcribe",
  simplifier: "/simplifier",
  tasks: "/tasks",
  summarizer: "/summarizer",
  blogger: "/blogger",
  broadcast: "/broadcast",
  nutritionist: "/nutritionist",
  admin: "/admin",
};

type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";

/** Platforms where home screen shortcuts are meaningful */
const MOBILE_PLATFORMS = new Set(["android", "android_x", "ios"]);

export function ModeSelectorPage() {
  const navigate = useNavigate();
  const { impact } = useHaptic();
  const [homeScreenStatus, setHomeScreenStatus] = useState<HomeScreenStatus>("unknown");
  const [addingToHome, setAddingToHome] = useState(false);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const addingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleModeClick = useCallback(
    (route: string) => {
      impact("light");
      navigate(route);
    },
    [impact, navigate],
  );

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      setHomeScreenStatus("unsupported");
      return;
    }

    // Home screen shortcuts only make sense on mobile platforms
    if (!MOBILE_PLATFORMS.has(webApp.platform ?? "")) {
      setHomeScreenStatus("unsupported");
      return;
    }

    // addToHomeScreen requires Bot API 8.0+
    const version = parseFloat(webApp.version || "0");
    if (version < 8.0 || typeof webApp.addToHomeScreen !== "function") {
      setHomeScreenStatus("unsupported");
      return;
    }

    // Use checkHomeScreenStatus only to detect "added" — hide the button
    // if the shortcut already exists. Other statuses (including "unsupported")
    // are ignored because the method existence check above is the authoritative
    // capability indicator; checkHomeScreenStatus can give false negatives
    // on some Telegram clients.
    const handleStatusResult = (status: HomeScreenStatus) => {
      if (status === "added") {
        setHomeScreenStatus("added");
      }
    };

    if (typeof webApp.checkHomeScreenStatus === "function") {
      try {
        webApp.checkHomeScreenStatus(handleStatusResult);
      } catch {
        // SDK may throw WebAppMethodUnsupported — ignore, keep button visible
      }
    }

    // Listen for event-based status check (some clients deliver via event, not callback)
    const onChecked = (evt: { status: HomeScreenStatus }) => {
      const status = evt?.status ?? "unknown";
      if (status === "added" || status === "unsupported") {
        setHomeScreenStatus(status);
      }
    };

    // React to home screen addition while page is open
    const onAdded = () => {
      setHomeScreenStatus("added");
      setAddingToHome(false);
      setShowFallbackHint(false);
      clearTimeout(addingTimerRef.current);
    };

    webApp.onEvent?.("homeScreenChecked", onChecked);
    webApp.onEvent?.("homeScreenAdded", onAdded);

    return () => {
      webApp.offEvent?.("homeScreenChecked", onChecked);
      webApp.offEvent?.("homeScreenAdded", onAdded);
      clearTimeout(addingTimerRef.current);
    };
  }, []);

  const handleAddToHomeScreen = useCallback(() => {
    const wa = window.Telegram?.WebApp;
    if (typeof wa?.addToHomeScreen !== "function") {
      wa?.showAlert?.(`Функция недоступна. Версия Telegram: ${wa?.version ?? "?"}.`);
      return;
    }

    clearTimeout(addingTimerRef.current);
    setAddingToHome(true);
    setShowFallbackHint(false);

    try {
      impact("light");
    } catch {
      // Haptic feedback is non-critical
    }

    // Defensive: clear any leftover closing confirmation state from other pages
    try {
      wa.disableClosingConfirmation?.();
    } catch {
      // Non-critical — proceed anyway
    }

    // Diagnostic logging — check via chrome://inspect on Android
    console.log(
      "[home-screen] platform=%s version=%s addToHomeScreen=%s checkHomeScreenStatus=%s",
      wa.platform, wa.version, typeof wa.addToHomeScreen, typeof wa.checkHomeScreenStatus,
    );

    // Call addToHomeScreen synchronously in click handler — setTimeout would
    // break the user gesture context and some clients silently ignore the call.
    try {
      wa.addToHomeScreen();
      console.log("[home-screen] addToHomeScreen() called successfully");
    } catch (err) {
      console.error("[home-screen] addToHomeScreen() threw:", err);
      setAddingToHome(false);
      const msg = err instanceof Error ? err.message : String(err);
      wa.showAlert?.(`Ошибка: ${msg}`);
      return;
    }

    // Fallback: if no homeScreenAdded event fires within 4s, show manual
    // instructions. The SDK docs warn: "the event may not be received
    // even if the icon has been added."
    addingTimerRef.current = setTimeout(() => {
      setAddingToHome(false);
      setShowFallbackHint(true);
    }, 4000);
  }, [impact]);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => api.get<UserProfileWithModes>("/api/user/me"),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  const modes = profile?.availableModes ?? [];
  const showHomeScreenButton = homeScreenStatus !== "unsupported" && homeScreenStatus !== "added";

  return (
    <div className="page">
      <h1 className="page-title">
        {profile ? `Привет, ${profile.firstName}` : "Режимы"}
      </h1>
      <p className="page-subtitle">Выберите режим работы</p>

      {modes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">🔒</div>
          <div className="empty-state-text">Нет доступных режимов</div>
        </div>
      ) : (
        <div className="mode-grid">
          {modes.map((mode) => {
            const meta = MODE_LABELS[mode];
            if (!meta) return null;
            const route = MODE_ROUTES[mode];
            if (!route) return null;

            return (
              <button
                key={mode}
                className="mode-card"
                onClick={() => handleModeClick(route)}
              >
                <span className="mode-card-emoji">{meta.emoji}</span>
                <span className="mode-card-label">{meta.label}</span>
                <span className="mode-card-desc">{meta.description}</span>
              </button>
            );
          })}
        </div>
      )}

      {showHomeScreenButton && (
        <button
          className="home-screen-btn"
          disabled={addingToHome}
          onClick={handleAddToHomeScreen}
        >
          {addingToHome ? "Добавление..." : "Добавить на главный экран"}
        </button>
      )}

      {showFallbackHint && (
        <div className="home-screen-hint">
          <p>
            Если диалог не появился, добавьте вручную:
            <br />
            <strong>&#8942;</strong> (меню) → <strong>Add to Home Screen</strong>
          </p>
          <button
            className="home-screen-hint-dismiss"
            onClick={() => setShowFallbackHint(false)}
          >
            Понятно
          </button>
        </div>
      )}
    </div>
  );
}
