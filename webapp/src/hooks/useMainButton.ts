import { useEffect, useRef } from "react";
import { mainButton } from "@telegram-apps/sdk-react";

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  isEnabled?: boolean;
  isVisible?: boolean;
  isLoaderVisible?: boolean;
}

// Returns `false` on unsupported environments (every SDK call is guarded), so
// callers keep their in-content submit button. The click listener reads the
// latest handler through a ref so it can be registered once without re-binding.
export function useMainButton({
  text,
  onClick,
  isEnabled = true,
  isVisible = true,
  isLoaderVisible = false,
}: MainButtonOptions): boolean {
  const available = mainButton.mount.isAvailable();
  const handlerRef = useRef(onClick);
  handlerRef.current = onClick;

  useEffect(() => {
    if (!mainButton.mount.isAvailable()) return;
    try {
      if (!mainButton.isMounted()) mainButton.mount();
    } catch {
      // Mounting can fail if the parent viewport isn't ready — degrade silently.
    }
    if (!mainButton.onClick.isAvailable()) return;
    const off = mainButton.onClick(() => handlerRef.current());
    return () => {
      off();
      if (mainButton.setParams.isAvailable()) {
        mainButton.setParams({ isVisible: false });
      }
    };
  }, []);

  useEffect(() => {
    if (!mainButton.setParams.isAvailable()) return;
    mainButton.setParams({ text, isVisible, isEnabled, isLoaderVisible });
  }, [text, isVisible, isEnabled, isLoaderVisible]);

  return available;
}
