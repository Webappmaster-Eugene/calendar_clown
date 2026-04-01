import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type { OsintSearchDto, OsintSearchHistoryResponse, StartOsintSearchRequest } from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидание",
  searching: "Поиск",
  analyzing: "Анализ",
  completed: "Готов",
  failed: "Ошибка",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function OsintPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 20;

  const { data: searchData, isLoading, error } = useQuery({
    queryKey: ["osint", "searches", offset],
    queryFn: () => api.get<OsintSearchHistoryResponse>(
      `/api/osint?limit=${PAGE_SIZE}&offset=${offset}`
    ),
  });

  const searches = searchData?.searches ?? [];
  const total = searchData?.total ?? 0;

  const searchMutation = useMutation({
    mutationFn: (data: StartOsintSearchRequest) =>
      api.post<OsintSearchDto>("/api/osint", data),
    onSuccess: (result) => {
      setOffset(0);
      queryClient.invalidateQueries({ queryKey: ["osint"] });
      setQuery("");
      setSelectedId(result.id);
    },
  });

  const selectedSearch = selectedId !== null
    ? searches.find((s) => s.id === selectedId) ?? null
    : null;

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedSearch) {
    return (
      <OsintReport
        searchId={selectedSearch.id}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">OSINT Поиск</h1>

      <form
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) searchMutation.mutate({ query: query.trim() }); }}
        style={{ marginBottom: 16 }}
      >
        <div className="form-group">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поисковый запрос (человек, компания...)"
              style={{ flex: 1 }}
            />
            <VoiceButton
              mode="osint"
              onResult={(transcript) => setQuery((prev) => prev ? `${prev} ${transcript}` : transcript)}
            />
          </div>
        </div>
        {searchMutation.error && <div className="error-msg">{(searchMutation.error as Error).message}</div>}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={searchMutation.isPending || !query.trim()}
        >
          {searchMutation.isPending ? "Поиск..." : "Найти"}
        </button>
      </form>

      <div className="section-title">История</div>

      {searches.length === 0 && !isLoading && (
        <div className="empty-state"><div className="empty-state-text">Нет поисковых запросов</div></div>
      )}

      {searches.length > 0 && (
        <div className="list">
          {searches.map((s) => (
            <button
              key={s.id}
              className="list-item"
              style={{ cursor: "pointer", border: "none", width: "100%", textAlign: "left" }}
              onClick={() => setSelectedId(s.id)}
            >
              <div className="list-item-content">
                <div className="list-item-title">{s.query}</div>
                <div className="list-item-hint">
                  {statusLabel(s.status)} &middot; {s.sourcesCount} источников
                  {s.completedAt ? ` · ${new Date(s.completedAt).toLocaleDateString("ru-RU")}` : ""}
                </div>
              </div>
            </button>
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

function OsintReport({ searchId, onBack }: { searchId: number; onBack: () => void }) {
  const { data: search, isLoading } = useQuery({
    queryKey: ["osint", "search", searchId],
    queryFn: () => api.get<OsintSearchDto>(`/api/osint/${searchId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed") return false;
      return 3000;
    },
  });

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>Назад</button>

      {isLoading && <div className="loading">Загрузка отчёта...</div>}

      {search && (
        <>
          <h2 className="page-title">{search.query}</h2>
          <div className="card-hint" style={{ marginBottom: 12 }}>
            Статус: {statusLabel(search.status)} &middot; {search.sourcesCount} источников
          </div>

          {search.status === "pending" || search.status === "searching" || search.status === "analyzing" ? (
            <div className="loading">Обработка...</div>
          ) : search.status === "failed" ? (
            <div className="error-msg">{search.errorMessage ?? "Поиск не удался"}</div>
          ) : search.report ? (
            <div className="report-text">{search.report}</div>
          ) : (
            <div className="empty-state"><div className="empty-state-text">Отчёт не сформирован</div></div>
          )}
        </>
      )}
    </div>
  );
}
