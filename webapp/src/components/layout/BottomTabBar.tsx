import { useNavigate } from "react-router";
import { MODE_LABELS } from "@shared/constants";
import { MODE_ROUTES } from "../../lib/modes";
import { useHaptic } from "../../hooks/useHaptic";

interface BottomTabBarProps {
  recent: string[];
  currentMode?: string;
}

export function BottomTabBar({ recent, currentMode }: BottomTabBarProps) {
  const navigate = useNavigate();
  const { impact } = useHaptic();

  const items = recent.filter((m) => m !== currentMode && MODE_ROUTES[m]).slice(0, 4);

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
      {items.map((mode) => {
        const meta = MODE_LABELS[mode];
        if (!meta) return null;
        return (
          <button
            key={mode}
            className="bottom-tab"
            type="button"
            onClick={() => go(MODE_ROUTES[mode])}
            title={meta.label}
          >
            <span className="bottom-tab-emoji">{meta.emoji}</span>
            <span className="bottom-tab-label">{meta.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
