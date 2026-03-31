import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useHaptic } from "../hooks/useHaptic";
import { useAddToHomeScreen } from "../hooks/useAddToHomeScreen";
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

export function ModeSelectorPage() {
  const navigate = useNavigate();
  const { impact } = useHaptic();
  const { canShow, isAdding, trigger, diagnostics } = useAddToHomeScreen();
  const [showDebug, setShowDebug] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleModeClick = useCallback(
    (route: string) => {
      impact("light");
      navigate(route);
    },
    [impact, navigate],
  );

  // Triple-tap on title to show diagnostics panel.
  const handleTitleTap = useCallback(() => {
    tapCountRef.current += 1;
    if (tapCountRef.current >= 3) {
      setShowDebug((prev) => !prev);
      tapCountRef.current = 0;
      clearTimeout(tapTimerRef.current);
      return;
    }
    clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 600);
  }, []);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => api.get<UserProfileWithModes>("/api/user/me"),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  const modes = profile?.availableModes ?? [];

  return (
    <div className="page">
      <h1 className="page-title" onClick={handleTitleTap}>
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

      {canShow && (
        <button
          className="home-screen-btn"
          disabled={isAdding}
          onClick={trigger}
        >
          {isAdding ? "Добавление..." : "Добавить на главный экран"}
        </button>
      )}

      {showDebug && diagnostics.length > 0 && (
        <div className="home-screen-hint">
          <p><strong>Diagnostics</strong></p>
          <pre style={{ fontSize: 11, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {diagnostics.join("\n")}
          </pre>
          <button
            className="home-screen-hint-dismiss"
            onClick={() => setShowDebug(false)}
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
}
