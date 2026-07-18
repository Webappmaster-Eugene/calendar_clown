import { useCallback, useState } from "react";

const STORAGE_KEY = "recentModes";
const MAX_RECENT = 5;

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Tracks the modes the user has visited most recently (most-recent-first),
 *  persisted to localStorage. Powers the bottom quick-switch bar. */
export function useRecentModes() {
  const [recent, setRecent] = useState<string[]>(readStored);

  const record = useCallback((mode: string) => {
    setRecent((prev) => {
      if (prev[0] === mode) return prev;
      const next = [mode, ...prev.filter((m) => m !== mode)].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage may be unavailable (private mode / quota) — degrade silently.
      }
      return next;
    });
  }, []);

  return { recent, record };
}
