/**
 * Small icon button that copies the given text to the clipboard on click
 * and flips to a green check-mark for ~1.5s on success. Used inside
 * MessageBubble, AnswerCard, and ad-hoc across pages wherever a piece of
 * text needs a fast "copy" affordance (mirrors the bot UX).
 */
import type { CSSProperties } from "react";
import { useClipboard } from "../../hooks/useClipboard";

export interface CopyButtonProps {
  text: string;
  label?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  size?: "sm" | "md";
}

export function CopyButton({
  text,
  label,
  title = "Скопировать",
  className,
  style,
  size = "md",
}: CopyButtonProps) {
  const { copy, isCopied } = useClipboard();

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
    background: isCopied ? "#2e7d3220" : "transparent",
    color: isCopied ? "#2e7d32" : "var(--tg-theme-text-color, #000)",
    fontSize: size === "sm" ? 12 : 13,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 160ms, color 160ms",
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
        void copy(text);
      }}
    >
      <span aria-hidden>{isCopied ? "✓" : "📋"}</span>
      {label && <span>{isCopied ? "Скопировано" : label}</span>}
    </button>
  );
}
