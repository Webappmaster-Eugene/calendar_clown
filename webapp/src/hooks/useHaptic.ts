import { useCallback } from "react";
import { useTelegram } from "./useTelegram";

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "error" | "success" | "warning";

export function useHaptic() {
  const { webApp } = useTelegram();

  const impact = useCallback(
    (style: ImpactStyle = "light") => {
      webApp?.HapticFeedback.impactOccurred(style);
    },
    [webApp],
  );

  const notification = useCallback(
    (type: NotificationType) => {
      webApp?.HapticFeedback.notificationOccurred(type);
    },
    [webApp],
  );

  const selection = useCallback(() => {
    webApp?.HapticFeedback.selectionChanged();
  }, [webApp]);

  return { impact, notification, selection };
}
