import { useEffect, useRef } from "react";
import { mainButton } from "@telegram-apps/sdk-react";

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  isEnabled?: boolean;
  isVisible?: boolean;
  isLoaderVisible?: boolean;
}

/**
 * Drives the native Telegram MainButton for a screen's primary action.
 * Every SDK call is guarded by its own `isAvailable()`, so on unsupported
 * environments the hook is a no-op and returns `false` — callers should then
 * keep their in-content submit button. The click listener is registered once
 * and reads the latest handler through a ref to avoid re-binding on each render.
 */
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
