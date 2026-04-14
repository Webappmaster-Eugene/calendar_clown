import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type { SimplifierHistoryResponse, SimplificationDto } from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import { MessageBubble } from "../components/ui/MessageBubble";

const PAGE_SIZE = 10;

export function SimplifierPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [buffer, setBuffer] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<SimplificationDto | null>(null);
  const [offset, setOffset] = useState(0);

  const { data: historyData, isLoading, error } = useQuery({
    queryKey: ["simplifications", offset],
    queryFn: () => api.get<SimplifierHistoryResponse>(
      `/api/simplifier?limit=${PAGE_SIZE}&offset=${offset}`
    ),
  });

  const simplifications = historyData?.simplifications ?? [];
  const total = historyData?.total ?? 0;

  const simplifyMutation = useMutation({
    mutationFn: (inputText: string) =>
      api.post<SimplificationDto>("/api/simplifier", { text: inputText }),
    onSuccess: (data) => {
      setLastResult(data);
      setText("");
      setBuffer([]);
      setOffset(0);
      queryClient.invalidateQueries({ queryKey: ["simplifications"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/simplifier/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["simplifications"] });
    },
  });

  const handleAddToBuffer = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBuffer((prev) => [...prev, trimmed]);
    setText("");
  };

  const handleSimplify = () => {
    if (buffer.length > 0) {
      // Buffer mode: join all buffered texts + current textarea
      const parts = [...buffer];
      const trimmed = text.trim();
      if (trimmed) parts.push(trimmed);
      simplifyMutation.mutate(parts.join("\n\n"));
    } else {
      // Direct mode: current textarea only
      const trimmed = text.trim();
      if (trimmed) simplifyMutation.mutate(trimmed);
    }
  };

  const canSimplify = buffer.length > 0 || text.trim().length > 0;

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Упрощатель мыслей</h1>

      {/* Text input */}
      <div className="card" style={{ marginBottom: 16 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Вставьте текст для упрощения..."
          rows={5}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--tg-theme-hint-color, #ccc)",
            background: "var(--tg-theme-bg-color, #fff)",
            color: "var(--tg-theme-text-color, #000)",
            fontSize: 14,
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />

        {/* Buffer indicator */}
        {buffer.length > 0 && (
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "var(--tg-theme-secondary-bg-color, #f0f0f0)", fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>📝 В буфере: {buffer.length} {buffer.length === 1 ? "сообщение" : buffer.length < 5 ? "сообщения" : "сообщений"}</span>
              <button
                className="btn btn-small"
                onClick={() => setBuffer([])}
                style={{ fontSize: 12, padding: "3px 8px" }}
              >
                Очистить
              </button>
            </div>
            <div style={{ marginTop: 4, color: "var(--tg-theme-hint-color, #999)", fontSize: 12 }}>
              {buffer.map((b, i) => (
                <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {i + 1}. {b.substring(0, 60)}{b.length > 60 ? "..." : ""}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={handleAddToBuffer}
            disabled={!text.trim()}
          >
            + В буфер
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={handleSimplify}
            disabled={!canSimplify || simplifyMutation.isPending}
          >
            {simplifyMutation.isPending ? "Упрощаю..." : "🧹 Упростить"}
          </button>
        </div>

        {simplifyMutation.isError && (
          <div className="error-msg" style={{ marginTop: 8 }}>
            {(simplifyMutation.error as Error).message}
          </div>
        )}
      </div>

      {/* Voice input */}
      <div className="card" style={{ marginBottom: 16 }}>
        <VoiceButton
          mode="simplifier"
          endpoint="/api/voice/transcribe"
          label="Записать голос"
          hint="Расшифрую и добавлю в буфер"
          onResult={(transcript) => {
            if (transcript.trim()) {
              setBuffer((prev) => [...prev, transcript.trim()]);
            }
          }}
        />
      </div>

      {/* Last result */}
      {lastResult && lastResult.simplifiedText && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column" }}>
          <MessageBubble
            role="assistant"
            markdown={false}
            content={lastResult.simplifiedText}
            actions={["copy", "share"]}
          />
          {lastResult.originalText && (
            <details style={{ marginTop: 8 }}>
              <summary className="card-hint" style={{ cursor: "pointer" }}>
                Показать оригинал
              </summary>
              <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", marginTop: 6, opacity: 0.7 }}>
                {lastResult.originalText}
              </div>
            </details>
          )}
        </div>
      )}

      {/* History */}
      {simplifications.length === 0 && !isLoading && (
        <div className="empty-state">
          <div className="empty-state-emoji">🧹</div>
          <div className="empty-state-text">Нет упрощений</div>
        </div>
      )}

      {simplifications.length > 0 && (
        <div className="list">
          {simplifications.map((s) => (
            <div key={s.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="card-hint">
                  {s.inputType === "voice" ? "🎙" : s.inputType === "mixed" ? "🎙📝" : "📝"}{" "}
                  {s.status === "completed" ? "Готово" : s.status === "failed" ? "Ошибка" : "Обработка..."}
                </span>
                <span className="card-hint">
                  {new Date(s.createdAt).toLocaleString("ru-RU")}
                </span>
              </div>
              {s.simplifiedText ? (
                <MessageBubble
                  role="assistant"
                  markdown={false}
                  content={s.simplifiedText}
                  actions={["copy", "share"]}
                  style={{ maxWidth: "100%" }}
                />
              ) : s.status === "failed" ? (
                <div className="error-msg">{s.errorMessage ?? "Ошибка"}</div>
              ) : null}
              {s.simplifiedText && (
                <details style={{ marginTop: 6 }}>
                  <summary className="card-hint" style={{ cursor: "pointer" }}>
                    Оригинал
                  </summary>
                  <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", marginTop: 4, opacity: 0.7 }}>
                    {s.originalText}
                  </div>
                </details>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => deleteMutation.mutate(s.id)}
                  disabled={deleteMutation.isPending}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="form-row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button
            className="btn btn-small"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ←
          </button>
          <span className="card-hint" style={{ padding: "0 8px" }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} из {total}
          </span>
          <button
            className="btn btn-small"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
