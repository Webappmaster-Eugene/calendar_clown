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
  const addingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const addedHandlerRef = useRef<(() => void) | null>(null);

  const handleModeClick = useCallback(
    (route: string) => {
      impact("light");
      navigate(route);
    },
    [impact, navigate],
  );

  // ModeSelectorPage is read-only (no forms, no unsaved data).
  // Disable closing confirmation here to prevent it from blocking
  // addToHomeScreen() — the global enableClosingConfirmation() in
  // TelegramProvider is restored on unmount so inner pages stay protected.
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    webApp.disableClosingConfirmation?.();

    return () => {
      webApp.enableClosingConfirmation?.();
    };
  }, []);

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
    const onAdded = () => setHomeScreenStatus("added");

    webApp.onEvent?.("homeScreenChecked", onChecked);
    webApp.onEvent?.("homeScreenAdded", onAdded);

    return () => {
      webApp.offEvent?.("homeScreenChecked", onChecked);
      webApp.offEvent?.("homeScreenAdded", onAdded);
      clearTimeout(addingTimerRef.current);
      // Clean up click-scoped homeScreenAdded listener (registered in handleAddToHomeScreen)
      if (addedHandlerRef.current) {
        webApp.offEvent?.("homeScreenAdded", addedHandlerRef.current);
        addedHandlerRef.current = null;
      }
    };
  }, []);

  const handleAddToHomeScreen = useCallback(() => {
    const wa = window.Telegram?.WebApp;
    if (typeof wa?.addToHomeScreen !== "function") {
      wa?.showAlert?.(`Функция недоступна. Версия Telegram: ${wa?.version ?? "?"}.`);
      return;
    }

    setAddingToHome(true);

    try {
      impact("light");
    } catch {
      // Haptic feedback is non-critical — don't block the main action
    }

    try {
      wa.addToHomeScreen();
    } catch (err) {
      setAddingToHome(false);
      const msg = err instanceof Error ? err.message : String(err);
      wa.showAlert?.(`Ошибка: ${msg}`);
      return;
    }

    // Listen for successful addition
    const onAdded = () => {
      clearTimeout(addingTimerRef.current);
      setAddingToHome(false);
      setHomeScreenStatus("added");
      wa.offEvent?.("homeScreenAdded", onAdded);
      addedHandlerRef.current = null;
    };

    // Clean up any previous listener (defensive: handles edge cases)
    if (addedHandlerRef.current) {
      wa.offEvent?.("homeScreenAdded", addedHandlerRef.current);
    }
    addedHandlerRef.current = onAdded;
    wa.onEvent?.("homeScreenAdded", onAdded);

    // Fallback: reset loading state after timeout if no event received.
    // Re-check status to detect silent success (docs: "the event may not
    // be received even if the icon has been added").
    addingTimerRef.current = setTimeout(() => {
      setAddingToHome(false);
      if (addedHandlerRef.current) {
        wa.offEvent?.("homeScreenAdded", addedHandlerRef.current);
        addedHandlerRef.current = null;
      }

      if (typeof wa.checkHomeScreenStatus === "function") {
        try {
          wa.checkHomeScreenStatus((status) => {
            if (status === "added") {
              setHomeScreenStatus("added");
            } else if (status === "unsupported") {
              setHomeScreenStatus("unsupported");
              wa.showAlert?.("Ваше устройство не поддерживает добавление на главный экран.");
            }
          });
        } catch {
          // Ignore
        }
      }
    }, 3000);
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
    </div>
  );
}
