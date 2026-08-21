import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MODE_LABELS } from "@shared/constants";
import type { UserProfile } from "@shared/types";
import { api } from "../../api/client";
import { MODE_ROUTES, TAB_BAR_MODES } from "../../lib/modes";
import { useHaptic } from "../../hooks/useHaptic";

interface BottomTabBarProps {
  currentMode?: string;
}

interface UserProfileWithModes extends UserProfile {
  availableModes: string[];
}

export function BottomTabBar({ currentMode }: BottomTabBarProps) {
  const navigate = useNavigate();
  const { impact } = useHaptic();

  // Shares the cache with every page that reads the profile, so this costs no
  // extra request. Until it resolves, all tabs show — the set only ever shrinks,
  // which is less jarring than tabs appearing after the fact.
  const { data: profile } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => api.get<UserProfileWithModes>("/api/user/me"),
    staleTime: 5 * 60_000,
  });
  const allowed = profile?.availableModes;

  const go = (route: string) => {
    impact("light");
    navigate(route);
  };

  return (
    <nav className="bottom-tab-bar">
      <button className="bottom-tab" type="button" onClick={() => go("/")} title="Все режимы">
        <span className="bottom-tab-emoji">⚏</span>
        <span className="bottom-tab-label">Режимы</span>
      </button>
      {TAB_BAR_MODES.filter((m) => !allowed || allowed.includes(m)).map((mode) => {
        const meta = MODE_LABELS[mode];
        if (!meta) return null;
        return (
          <button
            key={mode}
            className={`bottom-tab${mode === currentMode ? " active" : ""}`}
            type="button"
            onClick={() => go(MODE_ROUTES[mode])}
            title={meta.label}
            aria-current={mode === currentMode ? "page" : undefined}
          >
            <span className="bottom-tab-emoji">{meta.emoji}</span>
            <span className="bottom-tab-label">{meta.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
