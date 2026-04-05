/**
 * Share-text icon button — delegates to useShareText, which prefers
 * Telegram's native share sheet and falls back to clipboard copy.
 */
import type { CSSProperties } from "react";
import { useShareText } from "../../hooks/useShareText";

export interface ShareButtonProps {
  text: string;
  label?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  size?: "sm" | "md";
}

export function ShareButton({
  text,
  label,
  title = "Поделиться",
  className,
  style,
  size = "md",
}: ShareButtonProps) {
  const { share } = useShareText();

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
      style={{ ...baseStyle, ...style }}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        void share(text);
      }}
    >
      <span aria-hidden>↗️</span>
      {label && <span>{label}</span>}
    </button>
  );
}
