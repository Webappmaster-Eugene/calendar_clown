import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TranscriptionDto } from "@shared/types";

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
  const { data: transcriptions, isLoading, error } = useQuery({
    queryKey: ["transcriptions"],
    queryFn: () => api.get<TranscriptionDto[]>("/api/transcriptions"),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Транскрипции</h1>

      <p className="page-subtitle">
        Отправьте голосовое сообщение боту в Telegram для транскрибации.
      </p>

      {transcriptions && transcriptions.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎙️</div>
          <div className="empty-state-text">Нет транскрипций</div>
        </div>
      )}

      {transcriptions && transcriptions.length > 0 && (
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
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {t.transcript}
                </div>
              ) : t.status === "failed" ? (
                <div className="error-msg">{t.errorMessage ?? "Ошибка транскрибации"}</div>
              ) : null}
              <div className="card-hint" style={{ marginTop: 6 }}>
                {new Date(t.createdAt).toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
