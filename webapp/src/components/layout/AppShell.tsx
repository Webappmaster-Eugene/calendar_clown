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
  "/simplifier": "simplifier",
  "/summarizer": "summarizer",
  "/blogger": "blogger",
  "/broadcast": "broadcast",
  "/admin": "admin",
  "/tasks": "tasks",
};

/** Top-level mode routes (direct children of root) */
const TOP_LEVEL_ROUTES = new Set(
  Object.entries(ROUTE_TO_MODE)
    .filter(([path]) => path.split("/").filter(Boolean).length === 1)
    .map(([path]) => path),
);

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { webApp } = useTelegram();

  const isRoot = location.pathname === "/";
  const modeKey = ROUTE_TO_MODE[location.pathname];
  const modeMeta = modeKey ? MODE_LABELS[modeKey] : null;

  const handleBack = useCallback(() => {
    webApp?.HapticFeedback.impactOccurred("light");
    if (TOP_LEVEL_ROUTES.has(location.pathname)) {
      navigate("/");
    } else {
      navigate(-1);
    }
  }, [navigate, location.pathname, webApp]);

  const handleHome = useCallback(() => {
    webApp?.HapticFeedback.impactOccurred("light");
    navigate("/");
  }, [navigate, webApp]);

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
        <button className="mode-indicator" onClick={handleHome} type="button">
          <span className="mode-indicator-chevron">&#8249;</span>
          <span className="mode-indicator-emoji">{modeMeta.emoji}</span>
          <span className="mode-indicator-label">{modeMeta.label}</span>
        </button>
      )}
      {children}
    </div>
  );
}
