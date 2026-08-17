import { useState, type CSSProperties } from "react";
import { useShareText } from "../../hooks/useShareText";

export interface ShareButtonProps {
  text: string;
  label?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  size?: "sm" | "md";
  /** Custom share flow (e.g. Telegram prepared message by messageId). */
  onShare?: () => Promise<unknown>;
}

export function ShareButton({
  text,
  label,
  title = "Поделиться",
  className,
  style,
  size = "md",
  onShare,
}: ShareButtonProps) {
  const { share } = useShareText();
  const [busy, setBusy] = useState(false);

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: size === "sm" ? 28 : 36,
    minHeight: size === "sm" ? 28 : 36,
    padding: label ? "4px 10px" : "4px 8px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ccc)",
    background: "transparent",
    color: "var(--tg-theme-text-color, #000)",
    fontSize: size === "sm" ? 12 : 13,
    fontWeight: 500,
    cursor: "pointer",
  };

  return (
    <button
      type="button"
      className={className}
      style={{ ...baseStyle, ...style, opacity: busy ? 0.5 : undefined }}
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await (onShare ? onShare() : share(text));
        } finally {
          setBusy(false);
        }
      }}
    >
      <span aria-hidden>{busy ? "…" : "↗️"}</span>
      {label && <span>{label}</span>}
    </button>
  );
}
