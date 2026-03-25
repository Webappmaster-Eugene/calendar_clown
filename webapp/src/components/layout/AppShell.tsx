import { useEffect, useCallback, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router";
import { useTelegram } from "../../hooks/useTelegram";
import { MODE_LABELS } from "@shared/constants";

interface AppShellProps {
  children: ReactNode;
}

/** Maps route paths to mode keys from MODE_LABELS */
const ROUTE_TO_MODE: Record<string, string> = {
  "/calendar": "calendar",
  "/calendar/new": "calendar",
  "/expenses": "expenses",
  "/gandalf": "gandalf",
  "/goals": "goals",
  "/reminders": "reminders",
  "/wishlist": "wishlist",
  "/dates": "notable_dates",
  "/digest": "digest",
  "/osint": "osint",
  "/neuro": "neuro",
  "/transcribe": "transcribe",
  "/summarizer": "summarizer",
  "/blogger": "blogger",
  "/broadcast": "broadcast",
  "/admin": "admin",
};

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { webApp } = useTelegram();

  const isRoot = location.pathname === "/";
  const modeKey = ROUTE_TO_MODE[location.pathname];
  const modeMeta = modeKey ? MODE_LABELS[modeKey] : null;

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  useEffect(() => {
    if (!webApp) return;

    if (isRoot) {
      webApp.BackButton.hide();
    } else {
      webApp.BackButton.show();
      webApp.BackButton.onClick(handleBack);
    }

    return () => {
      webApp.BackButton.offClick(handleBack);
    };
  }, [webApp, isRoot, handleBack]);

  return (
    <div className="app-shell">
      {modeMeta && (
        <div className="mode-indicator">
          <span className="mode-indicator-emoji">{modeMeta.emoji}</span>
          <span className="mode-indicator-label">{modeMeta.label}</span>
        </div>
      )}
      {children}
    </div>
  );
}
