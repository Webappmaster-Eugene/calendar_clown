import { useEffect, useCallback, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router";
import { backButton, hapticFeedback } from "@telegram-apps/sdk-react";
import { MODE_LABELS } from "@shared/constants";
import { ROUTE_TO_MODE as BASE_ROUTE_TO_MODE } from "../../lib/modes";
import { useRecentModes } from "../../hooks/useRecentModes";
import { BottomTabBar } from "./BottomTabBar";

interface AppShellProps {
  children: ReactNode;
}

/** Route → mode key. Extends the shared map with subroutes that still belong to a mode. */
const ROUTE_TO_MODE: Record<string, string> = {
  ...BASE_ROUTE_TO_MODE,
  "/calendar/new": "calendar",
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
  const { recent, record } = useRecentModes();

  const isRoot = location.pathname === "/";
  const modeKey = ROUTE_TO_MODE[location.pathname];
  const modeMeta = modeKey ? MODE_LABELS[modeKey] : null;
  // The chat composer owns the bottom edge (fixed input row) — the quick-switch
  // bar would cover it, so it's suppressed on that immersive route.
  const showTabBar = !isRoot && modeKey !== "neuro";

  useEffect(() => {
    if (modeKey) record(modeKey);
  }, [modeKey, record]);

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
      {showTabBar && <BottomTabBar recent={recent} currentMode={modeKey} />}
    </div>
  );
}
