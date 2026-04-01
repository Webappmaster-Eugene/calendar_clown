import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useHaptic } from "../hooks/useHaptic";
import { useAddToHomeScreen } from "../hooks/useAddToHomeScreen";
import type { UserProfile, CreateSupportReportRequest } from "@shared/types";
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
  const homeScreen = useAddToHomeScreen();
  const [showDetails, setShowDetails] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const handleModeClick = useCallback(
    (route: string) => {
      impact("light");
      navigate(route);
    },
    [impact, navigate],
  );

  const reportMutation = useMutation({
    mutationFn: (data: CreateSupportReportRequest) =>
      api.post<{ id: number }>("/api/support-reports", data),
    onSuccess: () => setReportSent(true),
  });

  const handleSendReport = () => {
    reportMutation.mutate({
      diagnostics: homeScreen.diagnostics.join("\n"),
      platform: homeScreen.diagnostics[0]?.match(/platform=(\S+)/)?.[1],
      appVersion: homeScreen.diagnostics[0]?.match(/version=(\S+)/)?.[1],
      category: "home_screen",
    });
  };

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => api.get<UserProfileWithModes>("/api/user/me"),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  const modes = profile?.availableModes ?? [];

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

      {/* ── Home screen button ── */}
      {homeScreen.canShow && homeScreen.status === "idle" && (
        <button
          className="home-screen-btn"
          disabled={homeScreen.isAdding}
          onClick={homeScreen.trigger}
        >
          {homeScreen.isAdding ? "Добавление..." : "Добавить на главный экран"}
        </button>
      )}

      {/* ── Success notification ── */}
      {homeScreen.status === "added" && (
        <div className="home-screen-hint">
          <p>
            <strong>Приложение добавлено!</strong>
            <br />
            Ищите «Советник» на главном экране телефона.
          </p>
          <button className="home-screen-hint-dismiss" onClick={homeScreen.dismiss}>
            Понятно
          </button>
        </div>
      )}

      {/* ── Failure notification ── */}
      {homeScreen.status === "failed" && !reportSent && (
        <div className="home-screen-hint">
          <p>
            <strong>Не удалось добавить</strong>
            <br />
            Проверьте: Настройки → Приложения → Telegram → Разрешения → Ярлыки на главном экране
          </p>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button className="home-screen-hint-dismiss" onClick={homeScreen.retry}>
              Попробовать ещё раз
            </button>
            <button
              className="home-screen-hint-dismiss"
              onClick={() => setShowDetails((prev) => !prev)}
            >
              {showDetails ? "Скрыть детали" : "Показать детали"}
            </button>
            <button
              className="home-screen-hint-dismiss"
              style={{ color: "var(--tg-theme-destructive-text-color, #e53935)" }}
              onClick={handleSendReport}
              disabled={reportMutation.isPending}
            >
              {reportMutation.isPending ? "Отправка..." : "Отправить отчёт"}
            </button>
          </div>

          {showDetails && (
            <pre style={{ marginTop: 8, fontSize: 10, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-all", opacity: 0.7 }}>
              {homeScreen.diagnostics.join("\n")}
            </pre>
          )}
        </div>
      )}

      {/* ── Report sent confirmation ── */}
      {reportSent && (
        <div className="home-screen-hint">
          <p>
            <strong>Отчёт отправлен администратору</strong>
            <br />
            Мы поможем разобраться!
          </p>
          <button className="home-screen-hint-dismiss" onClick={() => setReportSent(false)}>
            Понятно
          </button>
        </div>
      )}
    </div>
  );
}
