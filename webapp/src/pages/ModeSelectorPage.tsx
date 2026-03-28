import { useState, useEffect, useCallback } from "react";
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
  summarizer: "/summarizer",
  blogger: "/blogger",
  broadcast: "/broadcast",
  admin: "/admin",
  tasks: "/tasks",
};

type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";

export function ModeSelectorPage() {
  const navigate = useNavigate();
  const { impact } = useHaptic();
  const [homeScreenStatus, setHomeScreenStatus] = useState<HomeScreenStatus>("unknown");

  const handleModeClick = useCallback(
    (route: string) => {
      impact("light");
      navigate(route);
    },
    [impact, navigate],
  );

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp || typeof webApp.checkHomeScreenStatus !== "function") {
      setHomeScreenStatus("unsupported");
      return;
    }

    webApp.checkHomeScreenStatus((status) => setHomeScreenStatus(status));

    // React to home screen addition while page is open
    const onAdded = () => setHomeScreenStatus("added");
    if (typeof webApp.onEvent === "function") {
      webApp.onEvent("homeScreenAdded", onAdded);
    }
    return () => {
      if (typeof webApp.offEvent === "function") {
        webApp.offEvent("homeScreenAdded", onAdded);
      }
    };
  }, []);

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
          onClick={() => window.Telegram?.WebApp?.addToHomeScreen?.()}
        >
          📱 Добавить на главный экран
        </button>
      )}
    </div>
  );
}
