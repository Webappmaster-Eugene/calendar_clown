import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  DigestRubricDto,
  DigestChannelDto,
  CreateRubricRequest,
} from "@shared/types";

export function DigestPage() {
  const [selectedRubricId, setSelectedRubricId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const queryClient = useQueryClient();

  const { data: rubrics, isLoading, error } = useQuery({
    queryKey: ["digest", "rubrics"],
    queryFn: () => api.get<DigestRubricDto[]>("/api/digest/rubrics"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateRubricRequest) =>
      api.post<DigestRubricDto>("/api/digest/rubrics", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest", "rubrics"] });
      setShowForm(false);
      setName("");
      setKeywords("");
    },
  });

  const deleteRubricMutation = useMutation({
    mutationFn: (id: number) =>
      api.del<void>(`/api/digest/rubrics/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest", "rubrics"] });
    },
  });

  const toggleRubricMutation = useMutation({
    mutationFn: (id: number) =>
      api.put<DigestRubricDto>(`/api/digest/rubrics/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest", "rubrics"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedRubricId !== null) {
    return <RubricChannels rubricId={selectedRubricId} onBack={() => setSelectedRubricId(null)} />;
  }

  return (
    <div className="page">
      <h1 className="page-title">Дайджест</h1>

      {rubrics && rubrics.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">📰</div>
          <div className="empty-state-text">Нет рубрик</div>
        </div>
      )}

      {rubrics && rubrics.length > 0 && (
        <div className="list">
          {rubrics.map((r) => (
            <div
              key={r.id}
              className="list-item"
              style={{ opacity: r.isActive ? 1 : 0.5 }}
            >
              <button
                style={{ cursor: "pointer", border: "none", background: "none", display: "flex", alignItems: "center", flex: 1, textAlign: "left", padding: 0 }}
                onClick={() => setSelectedRubricId(r.id)}
              >
                <span className="list-item-emoji">{r.emoji || "📰"}</span>
                <div className="list-item-content">
                  <div className="list-item-title">
                    {r.name}
                    {!r.isActive && <span style={{ marginLeft: 8, fontSize: 12, color: "#999" }}>(на паузе)</span>}
                  </div>
                  <div className="list-item-hint">
                    {r.channelCount ?? 0} каналов &middot; {r.keywords.join(", ")}
                  </div>
                </div>
              </button>
              <div className="list-item-actions" style={{ display: "flex", gap: 4 }}>
                <button
                  className="btn btn-small"
                  onClick={(e) => { e.stopPropagation(); toggleRubricMutation.mutate(r.id); }}
                  disabled={toggleRubricMutation.isPending}
                  title={r.isActive ? "Поставить на паузу" : "Возобновить"}
                >
                  {r.isActive ? "⏸" : "▶️"}
                </button>
                <button
                  className="btn btn-danger btn-small"
                  onClick={(e) => { e.stopPropagation(); deleteRubricMutation.mutate(r.id); }}
                  disabled={deleteRubricMutation.isPending}
                  title="Удалить рубрику"
                >
                  Уд.
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            createMutation.mutate({
              name: name.trim(),
              keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
            });
          }}>
            <div className="form-group">
              <label className="form-label">Название рубрики</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" />
            </div>
            <div className="form-group">
              <label className="form-label">Ключевые слова (через запятую)</label>
              <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="AI, tech, news" />
            </div>
            {createMutation.error && <div className="error-msg">{(createMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || !name.trim()}>Создать</button>
            </div>
          </form>
        </div>
      )}

      {!showForm && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}

function RubricChannels({ rubricId, onBack }: { rubricId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [username, setUsername] = useState("");

  const { data: channels, isLoading } = useQuery({
    queryKey: ["digest", "channels", rubricId],
    queryFn: () => api.get<DigestChannelDto[]>(`/api/digest/rubrics/${rubricId}/channels`),
  });

  const addMutation = useMutation({
    mutationFn: (channelUsername: string) =>
      api.post<DigestChannelDto>(`/api/digest/rubrics/${rubricId}/channels`, { channelUsername }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest", "channels", rubricId] });
      setShowAdd(false);
      setUsername("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (channelId: number) =>
      api.del<void>(`/api/digest/channels/${channelId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest", "channels", rubricId] });
    },
  });

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>Назад</button>
      <h2 className="page-title">Каналы</h2>

      {isLoading && <div className="loading">Загрузка каналов...</div>}

      {channels && channels.length === 0 && (
        <div className="empty-state"><div className="empty-state-text">Нет каналов в этой рубрике</div></div>
      )}

      {channels && channels.length > 0 && (
        <div className="list">
          {channels.map((ch) => (
            <div key={ch.id} className="list-item">
              <div className="list-item-content">
                <div className="list-item-title">@{ch.channelUsername}</div>
                <div className="list-item-hint">{ch.channelTitle ?? "Неизвестно"}</div>
              </div>
              <div className="list-item-actions">
                <button className="btn btn-danger btn-small" onClick={() => deleteMutation.mutate(ch.id)}>Уд.</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={(e) => { e.preventDefault(); if (username.trim()) addMutation.mutate(username.trim()); }}>
            <div className="form-group">
              <label className="form-label">Имя канала</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@channel" />
            </div>
            {addMutation.error && <div className="error-msg">{(addMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={addMutation.isPending || !username.trim()}>Добавить</button>
            </div>
          </form>
        </div>
      )}

      {!showAdd && <button className="fab" onClick={() => setShowAdd(true)}>+</button>}
    </div>
  );
}
