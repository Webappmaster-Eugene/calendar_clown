/**
 * Unified renderer for AI / assistant / user / system messages in the Mini App.
 *
 * Design goals:
 *   1. Body text is natively selectable (user-select: text) and does NOT
 *      swallow long-press events — the WebView's native "Copy / Select All"
 *      menu appears on long-press, mirroring how copying works from bot
 *      messages in Telegram.
 *   2. An explicit Copy + Share action row lives at the bottom of assistant
 *      bubbles, visually separated from the body by a divider — mirrors the
 *      bot pattern of sending content and controls as two separate messages.
 *   3. Markdown is rendered via react-markdown + remark-gfm when enabled
 *      (default for assistant). URLs auto-link. Code blocks get mono font.
 *   4. Pending state shows a typing indicator; errored state shows a red
 *      left-border accent.
 *
 * Callers can also pass structured `children` for cases where the response
 * is not plain text (e.g., the Nutritionist AnalysisCard). In that case they
 * must also pass `toText` — a serializer that produces the plain-text
 * version used by Copy/Share actions.
 */
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";
import { ShareButton } from "./ShareButton";

export type MessageRole = "assistant" | "user" | "system" | "tool";
export type MessageAction = "copy" | "share" | "delete" | "edit" | "regenerate";

export interface MessageBubbleProps {
  role?: MessageRole;
  content?: string;
  markdown?: boolean;
  meta?: ReactNode;
  timestamp?: string | Date;
  actions?: ReadonlyArray<MessageAction>;
  onAction?: (action: MessageAction) => void;
  children?: ReactNode;
  /** Serializer for Copy/Share when `children` replaces `content`. */
  toText?: () => string;
  pending?: boolean;
  errored?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function MessageBubble({
  role = "assistant",
  content,
  markdown = role === "assistant" || role === "tool",
  meta,
  timestamp,
  actions,
  onAction,
  children,
  toText,
  pending,
  errored,
  className,
  style,
}: MessageBubbleProps) {
  const isAssistant = role === "assistant" || role === "tool";
  const isUser = role === "user";

  const bubbleStyle: CSSProperties = {
    background: isUser
      ? "var(--tg-theme-button-color, #2481cc)"
      : "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    color: isUser
      ? "var(--tg-theme-button-text-color, #fff)"
      : "var(--tg-theme-text-color, #000)",
    padding: "10px 14px",
    borderRadius: 16,
    borderBottomRightRadius: isUser ? 4 : 16,
    borderBottomLeftRadius: isAssistant ? 4 : 16,
    maxWidth: "92%",
    alignSelf: isUser ? "flex-end" : "flex-start",
    fontSize: 14,
    lineHeight: 1.55,
    wordBreak: "break-word",
    userSelect: "text",
    WebkitUserSelect: "text",
    boxShadow: errored ? "inset 4px 0 0 var(--tg-theme-destructive-text-color, #e53935)" : undefined,
    ...style,
  };

  const textForActions = toText ? toText() : content ?? "";
  const visibleActions = isAssistant && actions && actions.length > 0 ? actions : null;

  return (
    <div className={className} style={bubbleStyle}>
      {meta && (
        <div
          className="card-hint"
          style={{ fontSize: 11, marginBottom: 6, opacity: 0.75 }}
        >
          {meta}
        </div>
      )}

      <div style={{ userSelect: "text", WebkitUserSelect: "text" }}>
        {children ?? (
          <>
            {pending && (!content || content.trim() === "") ? (
              <TypingDots />
            ) : content && markdown ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            ) : content ? (
              <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>
            ) : null}
          </>
        )}
      </div>

      {timestamp && (
        <div
          className="card-hint"
          style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: isUser ? "right" : "left" }}
        >
          {formatTimestamp(timestamp)}
        </div>
      )}

      {visibleActions && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid color-mix(in srgb, var(--tg-theme-hint-color, #999) 35%, transparent)",
            flexWrap: "wrap",
          }}
        >
          {visibleActions.includes("copy") && <CopyButton text={textForActions} size="sm" />}
          {visibleActions.includes("share") && <ShareButton text={textForActions} size="sm" />}
          {visibleActions.includes("regenerate") && (
            <ActionButton onClick={() => onAction?.("regenerate")} icon="🔄" title="Повторить" />
          )}
          {visibleActions.includes("edit") && (
            <ActionButton onClick={() => onAction?.("edit")} icon="✏️" title="Изменить" />
          )}
          {visibleActions.includes("delete") && (
            <ActionButton onClick={() => onAction?.("delete")} icon="🗑️" title="Удалить" />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Internal helpers ───────────────────────────────────────────

function ActionButton({
  onClick,
  icon,
  title,
}: {
  onClick: () => void;
  icon: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      aria-label={title}
      style={{
        minWidth: 28,
        minHeight: 28,
        padding: "4px 8px",
        borderRadius: 8,
        border: "1px solid var(--tg-theme-hint-color, #ccc)",
        background: "transparent",
        color: "inherit",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );
}

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="Печатает">
      <span />
      <span />
      <span />
    </span>
  );
}

function formatTimestamp(value: string | Date): string {
  try {
    const date = typeof value === "string" ? new Date(value) : value;
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Custom markdown components — compact, theme-aware, no heavy external CSS.
const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p style={{ margin: "0.4em 0" }}>{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ color: "var(--tg-theme-link-color, #2481cc)" }}
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          style={{
            background: "color-mix(in srgb, var(--tg-theme-hint-color, #999) 20%, transparent)",
            padding: "1px 4px",
            borderRadius: 4,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "0.92em",
          }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className={className}
        style={{
          display: "block",
          background: "color-mix(in srgb, var(--tg-theme-hint-color, #999) 15%, transparent)",
          padding: "10px 12px",
          borderRadius: 8,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: "0.88em",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre style={{ margin: "0.5em 0" }}>{children}</pre>,
  ul: ({ children }) => <ul style={{ margin: "0.4em 0", paddingLeft: "1.2em" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0.4em 0", paddingLeft: "1.2em" }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: "0.15em 0" }}>{children}</li>,
  h1: ({ children }) => <h3 style={{ margin: "0.6em 0 0.3em", fontSize: 17 }}>{children}</h3>,
  h2: ({ children }) => <h4 style={{ margin: "0.6em 0 0.3em", fontSize: 16 }}>{children}</h4>,
  h3: ({ children }) => <h5 style={{ margin: "0.6em 0 0.3em", fontSize: 15 }}>{children}</h5>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "0.5em 0",
        paddingLeft: 10,
        borderLeft: "3px solid var(--tg-theme-hint-color, #ccc)",
        opacity: 0.85,
      }}
    >
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0.5em 0" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: "1px solid var(--tg-theme-hint-color, #ccc)",
        padding: "4px 8px",
        textAlign: "left",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: "1px solid var(--tg-theme-hint-color, #ccc)", padding: "4px 8px" }}>
      {children}
    </td>
  ),
};
