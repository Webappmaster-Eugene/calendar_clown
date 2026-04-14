import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type { TranscribeHistoryResponse, TranscriptionDto } from "@shared/types";
import { MessageBubble } from "../components/ui/MessageBubble";
import { CopyButton } from "../components/ui/CopyButton";

const PAGE_SIZE = 10;

function formatStatus(status: string): string {
  switch (status) {
    case "pending": return "Ожидание";
    case "processing": return "Обработка...";
    case "completed": return "Готово";
    case "failed": return "Ошибка";
    default: return status;
  }
}

export function TranscribePage() {
  const queryClient = useQueryClient();
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const { data: historyData, isLoading, error } = useQuery({
    queryKey: ["transcriptions", offset],
    queryFn: () => api.get<TranscribeHistoryResponse>(
      `/api/transcribe?limit=${PAGE_SIZE}&offset=${offset}`
    ),
  });

  // Pending queue — poll every 5s while there are pending items
  const { data: pendingData } = useQuery({
    queryKey: ["transcriptions", "pending"],
    queryFn: () => api.get<TranscriptionDto[]>("/api/transcribe/pending"),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.length > 0 ? 5000 : false;
    },
  });

  const pendingItems = pendingData ?? [];

  const transcriptions = historyData?.transcriptions ?? [];
  const total = historyData?.total ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/transcribe/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transcriptions"] });
    },
  });

  const clearQueueMutation = useMutation({
    mutationFn: () => api.del<{ cleared: number }>("/api/transcribe/queue"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transcriptions"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Транскрипции</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <VoiceButton
          mode="transcribe"
          label="Записать голос"
          hint="Нажмите для записи и транскрибации"
          onResult={(transcript) => {
            setLastTranscript(transcript);
            setOffset(0);
            queryClient.invalidateQueries({ queryKey: ["transcriptions"] });
          }}
        />
        {lastTranscript && (
          <div style={{ marginTop: 10 }}>
            <MessageBubble
              role="assistant"
              markdown={false}
              content={lastTranscript}
              actions={["copy", "share"]}
              style={{ maxWidth: "100%" }}
            />
          </div>
        )}
      </div>

      <p className="page-subtitle">
        Или отправьте голосовое сообщение боту в Telegram.
      </p>

      {/* Pending queue */}
      {pendingItems.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>Очередь ({pendingItems.length})</span>
            <button
              className="btn btn-small"
              onClick={() => { if (confirm("Очистить очередь?")) clearQueueMutation.mutate(); }}
              disabled={clearQueueMutation.isPending}
              style={{ fontSize: 12 }}
            >
              Очистить
            </button>
          </div>
          {pendingItems.map((item, index) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--tg-theme-hint-color, #999)", minWidth: 20 }}>#{index + 1}</span>
              <span>{item.status === "processing" ? "🔄" : "⏳"}</span>
              <span style={{ flex: 1 }}>{formatStatus(item.status)}</span>
              {item.durationSeconds > 0 && (
                <span className="card-hint">{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {transcriptions.length === 0 && !isLoading && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎙️</div>
          <div className="empty-state-text">Нет транскрипций</div>
        </div>
      )}

      {transcriptions.length > 0 && (
        <div className="list">
          {transcriptions.map((t) => (
            <div key={t.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span className="card-hint">
                  {t.forwardedFromName ?? "Голосовое сообщение"}
                </span>
                <span className="card-hint">
                  {formatStatus(t.status)}
                </span>
              </div>
              {t.durationSeconds > 0 && (
                <div className="card-hint" style={{ marginBottom: 4 }}>
                  {Math.floor(t.durationSeconds / 60)}:{String(t.durationSeconds % 60).padStart(2, "0")}
                </div>
              )}
              {t.transcript ? (
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", userSelect: "text", WebkitUserSelect: "text" }}>
                  {t.transcript}
                </div>
              ) : t.status === "failed" ? (
                <div className="error-msg">{t.errorMessage ?? "Ошибка транскрибации"}</div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 6 }}>
                <span className="card-hint">
                  {new Date(t.createdAt).toLocaleString("ru-RU")}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {t.transcript && <CopyButton text={t.transcript} size="sm" />}
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => deleteMutation.mutate(t.id)}
                    disabled={deleteMutation.isPending}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
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
