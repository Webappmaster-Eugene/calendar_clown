import { useEffect, useCallback, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router";
import { backButton, hapticFeedback } from "@telegram-apps/sdk-react";
import { MODE_LABELS } from "@shared/constants";
import { ROUTE_TO_MODE as BASE_ROUTE_TO_MODE } from "../../lib/modes";
import { BottomTabBar } from "./BottomTabBar";

interface AppShellProps {
  children: ReactNode;
}

const ROUTE_TO_MODE: Record<string, string> = {
  ...BASE_ROUTE_TO_MODE,
  "/calendar/new": "calendar",
};

const TOP_LEVEL_ROUTES = new Set(
  Object.entries(ROUTE_TO_MODE)
    .filter(([path]) => path.split("/").filter(Boolean).length === 1)
    .map(([path]) => path),
);

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isRoot = location.pathname === "/";
  const modeKey = ROUTE_TO_MODE[location.pathname];
  const modeMeta = modeKey ? MODE_LABELS[modeKey] : null;
  // Everywhere except the mode grid itself, which already *is* the full list.
  const showTabBar = !isRoot;

  const handleBack = useCallback(() => {
    hapticFeedback.impactOccurred.ifAvailable("light");
    if (TOP_LEVEL_ROUTES.has(location.pathname)) {
      navigate("/");
    } else {
      navigate(-1);
    }
  }, [navigate, location.pathname]);

  const handleHome = useCallback(() => {
    hapticFeedback.impactOccurred.ifAvailable("light");
    navigate("/");
  }, [navigate]);

  // Published on :root so layers mounted outside the shell (toasts) can also keep
  // clear of the bar — see --tabbar-height / --bottom-safe in index.css.
  useEffect(() => {
    const root = document.documentElement;
    if (showTabBar) {
      root.setAttribute("data-tabbar", "1");
    } else {
      root.removeAttribute("data-tabbar");
    }
    return () => root.removeAttribute("data-tabbar");
  }, [showTabBar]);

  useEffect(() => {
    if (!backButton.show.isAvailable()) return;

    if (isRoot) {
      backButton.hide();
    } else {
      backButton.show();
      const off = backButton.onClick(handleBack);
      return () => {
        off();
      };
    }
  }, [isRoot, handleBack]);

  return (
    <div className={`app-shell${showTabBar ? " has-tabbar" : ""}`}>
      {modeMeta && (
        <button className="mode-indicator" onClick={handleHome} type="button">
          <span className="mode-indicator-chevron">&#8249;</span>
          <span className="mode-indicator-emoji">{modeMeta.emoji}</span>
          <span className="mode-indicator-label">{modeMeta.label}</span>
        </button>
      )}
      {children}
      {showTabBar && <BottomTabBar currentMode={modeKey} />}
    </div>
  );
}
