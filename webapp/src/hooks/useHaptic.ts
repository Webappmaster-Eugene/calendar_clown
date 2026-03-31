import { useCallback } from "react";
import { hapticFeedback } from "@telegram-apps/sdk-react";

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "error" | "success" | "warning";

export function useHaptic() {
  const impact = useCallback(
    (style: ImpactStyle = "light") => {
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred(style);
      }
    },
    [],
  );

  const notification = useCallback(
    (type: NotificationType) => {
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred(type);
      }
    },
    [],
  );

  const selection = useCallback(() => {
    if (hapticFeedback.selectionChanged.isAvailable()) {
      hapticFeedback.selectionChanged();
    }
  }, []);

  return { impact, notification, selection };
}
