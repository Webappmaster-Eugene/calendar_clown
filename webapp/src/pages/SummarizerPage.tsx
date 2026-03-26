import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type {
  WorkplaceDto,
  WorkAchievementDto,
  CreateWorkplaceRequest,
  AddAchievementRequest,
  UpdateWorkplaceRequest,
  SummaryDto,
} from "@shared/types";

export function SummarizerPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const queryClient = useQueryClient();

  const { data: workplaces, isLoading, error } = useQuery({
    queryKey: ["summarizer", "workplaces"],
    queryFn: () => api.get<WorkplaceDto[]>("/api/summarizer/workplaces"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateWorkplaceRequest) =>
      api.post<WorkplaceDto>("/api/summarizer/workplaces", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summarizer", "workplaces"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: UpdateWorkplaceRequest & { id: number }) =>
      api.put<WorkplaceDto>(`/api/summarizer/workplaces/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summarizer", "workplaces"] });
      resetForm();
    },
  });

  const deleteWorkplaceMutation = useMutation({
    mutationFn: (id: number) =>
      api.del<void>(`/api/summarizer/workplaces/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summarizer", "workplaces"] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setTitle("");
    setCompany("");
  };

  const startEdit = (w: WorkplaceDto) => {
    setEditingId(w.id);
    setTitle(w.title);
    setCompany(w.company ?? "");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (editingId) {
      updateMutation.mutate({ id: editingId, title: title.trim(), company: company.trim() || null });
    } else {
      createMutation.mutate({ title: title.trim(), company: company.trim() || undefined });
    }
  };

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedId !== null) {
    return <WorkplaceDetail workplaceId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const mutationPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error || updateMutation.error;

  return (
    <div className="page">
      <h1 className="page-title">Резюме</h1>

      {workplaces && workplaces.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">📋</div>
          <div className="empty-state-text">Нет мест работы</div>
        </div>
      )}

      {workplaces && workplaces.length > 0 && (
        <div className="list">
          {workplaces.map((w) => (
            <div key={w.id} className="list-item" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="list-item"
                style={{ cursor: "pointer", border: "none", flex: 1, textAlign: "left", background: "none", padding: 0 }}
                onClick={() => setSelectedId(w.id)}
              >
                <div className="list-item-content">
                  <div className="list-item-title">{w.title}</div>
                  <div className="list-item-hint">
                    {w.company ?? "Без компании"} &middot; {w.achievementCount} достижений
                  </div>
                </div>
              </button>
              <div className="list-item-actions" style={{ display: "flex", gap: 4 }}>
                <button
                  className="btn btn-icon"
                  onClick={(e) => { e.stopPropagation(); startEdit(w); }}
                  title="Редактировать"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-icon btn-danger"
                  disabled={deleteWorkplaceMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Удалить место работы?")) {
                      deleteWorkplaceMutation.mutate(w.id);
                    }
                  }}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Должность</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Разработчик" />
            </div>
            <div className="form-group">
              <label className="form-label">Компания (необязательно)</label>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Название компании" />
            </div>
            {mutationError && <div className="error-msg">{(mutationError as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={resetForm}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={mutationPending || !title.trim()}>
                {editingId ? "Сохранить" : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}

function WorkplaceDetail({ workplaceId, onBack }: { workplaceId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [editingAchId, setEditingAchId] = useState<number | null>(null);
  const [editAchText, setEditAchText] = useState("");

  const { data: achievements, isLoading } = useQuery({
    queryKey: ["summarizer", "achievements", workplaceId],
    queryFn: () => api.get<WorkAchievementDto[]>(`/api/summarizer/workplaces/${workplaceId}/achievements`),
  });

  const addMutation = useMutation({
    mutationFn: (data: AddAchievementRequest) =>
      api.post<WorkAchievementDto>("/api/summarizer/achievements", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summarizer", "achievements", workplaceId] });
      setText("");
    },
  });

  const updateAchMutation = useMutation({
    mutationFn: ({ id, text: newText }: { id: number; text: string }) =>
      api.put<WorkAchievementDto>(`/api/summarizer/achievements/${id}`, { text: newText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summarizer", "achievements", workplaceId] });
      setEditingAchId(null);
      setEditAchText("");
    },
  });

  const deleteAchievementMutation = useMutation({
    mutationFn: (id: number) =>
      api.del<void>(`/api/summarizer/achievements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summarizer", "achievements", workplaceId] });
    },
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<SummaryDto>(`/api/summarizer/workplaces/${workplaceId}/summary`),
    onSuccess: (result) => {
      setSummary(result.summary);
    },
  });

  const startEditAch = (a: WorkAchievementDto) => {
    setEditingAchId(a.id);
    setEditAchText(a.text);
  };

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>Назад</button>

      <button
        className="btn btn-primary btn-block"
        style={{ marginBottom: 16 }}
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
      >
        {generateMutation.isPending ? "Генерация..." : "Сгенерировать резюме"}
      </button>

      {generateMutation.error && <div className="error-msg">{(generateMutation.error as Error).message}</div>}

      {summary && (
        <div className="report-text" style={{ marginBottom: 16 }}>{summary}</div>
      )}

      <div className="section-title">Достижения</div>

      {isLoading && <div className="loading">Загрузка...</div>}

      {achievements && achievements.length === 0 && (
        <div className="empty-state"><div className="empty-state-text">Нет достижений</div></div>
      )}

      {achievements && achievements.length > 0 && (
        <div className="list">
          {achievements.map((a) => (
            <div key={a.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  {editingAchId === a.id ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); if (editAchText.trim()) updateAchMutation.mutate({ id: a.id, text: editAchText.trim() }); }}
                      style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
                    >
                      <textarea
                        className="input"
                        value={editAchText}
                        onChange={(e) => setEditAchText(e.target.value)}
                        rows={2}
                        style={{ flex: 1 }}
                        autoFocus
                      />
                      <button type="submit" className="btn btn-primary btn-small" disabled={updateAchMutation.isPending || !editAchText.trim()}>✓</button>
                      <button type="button" className="btn btn-small" onClick={() => { setEditingAchId(null); setEditAchText(""); }}>✕</button>
                    </form>
                  ) : (
                    <>
                      <div style={{ fontSize: 14 }}>{a.text}</div>
                      <div className="card-hint" style={{ marginTop: 4 }}>
                        {new Date(a.createdAt).toLocaleDateString("ru-RU")}
                      </div>
                    </>
                  )}
                </div>
                {editingAchId !== a.id && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      className="btn btn-icon"
                      onClick={() => startEditAch(a)}
                      title="Редактировать"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-icon btn-danger"
                      disabled={deleteAchievementMutation.isPending}
                      onClick={() => {
                        if (confirm("Удалить достижение?")) {
                          deleteAchievementMutation.mutate(a.id);
                        }
                      }}
                      title="Удалить"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        style={{ marginTop: 16 }}
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) addMutation.mutate({ workplaceId, text: text.trim() }); }}
      >
        <div className="form-group">
          <label className="form-label">Добавить достижение</label>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Что вы сделали?" rows={3} style={{ flex: 1 }} />
            <VoiceButton
              mode="summarizer"
              onResult={(transcript) => setText((prev) => prev ? `${prev} ${transcript}` : transcript)}
            />
          </div>
        </div>
        {addMutation.error && <div className="error-msg">{(addMutation.error as Error).message}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={addMutation.isPending || !text.trim()}>
          {addMutation.isPending ? "Добавление..." : "Добавить достижение"}
        </button>
      </form>
    </div>
  );
}
