/**
 * Minimal toast notification system — used by CopyButton, ShareButton,
 * MessageBubble, and any form mutation to surface success/error feedback.
 *
 * Intentionally lightweight: one queue, one portal, CSS transitions.
 * Safe-area-aware so it doesn't overlap fixed chat input rows.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  description: string;
  title?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "title">> {
  id: string;
  title?: string;
}

interface ToastContextValue {
  show: (opts: ToastOptions | string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (opts: ToastOptions | string) => {
      const normalized: ToastOptions = typeof opts === "string" ? { description: opts } : opts;
      counterRef.current += 1;
      const id = `toast_${Date.now()}_${counterRef.current}`;
      const record: ToastRecord = {
        id,
        title: normalized.title,
        description: normalized.description,
        variant: normalized.variant ?? "info",
        duration: normalized.duration ?? 2400,
      };
      setToasts((prev) => [...prev, record]);
      if (record.duration > 0) {
        setTimeout(() => dismiss(id), record.duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.variant}`}>
            {t.title && <div className="toast-title">{t.title}</div>}
            <div className="toast-description">{t.description}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Silent fallback so copy/share hooks don't crash if provider is missing.
    return {
      show: () => "",
      dismiss: () => {},
    };
  }
  return ctx;
}
