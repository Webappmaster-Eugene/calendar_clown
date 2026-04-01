import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import type { NotableDateDto, CreateNotableDateRequest } from "@shared/types";

const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const PAGE_SIZE = 10;

type DateTab = "upcoming" | "week" | "month" | "all";

export function NotableDatesPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const { showConfirm } = useTelegram();
  const [tab, setTab] = useState<DateTab>("upcoming");
  const [offset, setOffset] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [day, setDay] = useState(1);
  const [eventType, setEventType] = useState("birthday");
  const [description, setDescription] = useState("");

  // ─── Queries ──────────────────────────────────────────────────

  const { data: upcomingDates, isLoading: upcomingLoading } = useQuery({
    queryKey: ["notable-dates", "upcoming"],
    queryFn: () => api.get<NotableDateDto[]>("/api/notable-dates/upcoming"),
    enabled: tab === "upcoming",
  });

  const { data: weekResponse, isLoading: weekLoading } = useQuery({
    queryKey: ["notable-dates", "week"],
    queryFn: () => api.get<{ dates: NotableDateDto[]; total: number }>("/api/notable-dates?filter=week"),
    enabled: tab === "week",
  });

  const { data: monthResponse, isLoading: monthLoading } = useQuery({
    queryKey: ["notable-dates", "month"],
    queryFn: () => api.get<{ dates: NotableDateDto[]; total: number }>("/api/notable-dates?filter=month"),
    enabled: tab === "month",
  });

  const { data: allResponse, isLoading: allLoading } = useQuery({
    queryKey: ["notable-dates", "all", offset],
    queryFn: () => api.get<{ dates: NotableDateDto[]; total: number }>(
      `/api/notable-dates?limit=${PAGE_SIZE}&offset=${offset}`
    ),
    enabled: tab === "all",
  });

  const dates = tab === "upcoming" ? upcomingDates
    : tab === "week" ? weekResponse?.dates
    : tab === "month" ? monthResponse?.dates
    : allResponse?.dates;
  const total = tab === "all" ? (allResponse?.total ?? 0) : 0;
  const isLoading = tab === "upcoming" ? upcomingLoading
    : tab === "week" ? weekLoading
    : tab === "month" ? monthLoading
    : allLoading;

  // ─── Mutations ────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: CreateNotableDateRequest) =>
      api.post<NotableDateDto>("/api/notable-dates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: {
      id: number;
      name?: string;
      dateMonth?: number;
      dateDay?: number;
      description?: string | null;
      eventType?: string;
    }) => api.put<NotableDateDto>(`/api/notable-dates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/notable-dates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
    },
  });

  const togglePriorityMutation = useMutation({
    mutationFn: (id: number) =>
      api.put<{ toggled: boolean }>(`/api/notable-dates/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────

  const handleDelete = (id: number, dateName: string) => {
    showConfirm(`Удалить "${dateName}"?`, (confirmed) => {
      if (confirmed) deleteMutation.mutate(id);
    });
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName("");
    setDay(1);
    setDescription("");
    setEventType("birthday");
  };

  const startEdit = (d: NotableDateDto) => {
    setEditingId(d.id);
    setName(d.name);
    setMonth(d.dateMonth);
    setDay(d.dateDay);
    setEventType(d.eventType);
    setDescription(d.description ?? "");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        name: name.trim(),
        dateMonth: month,
        dateDay: day,
        eventType,
        description: description.trim() || null,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        dateMonth: month,
        dateDay: day,
        eventType,
        description: description.trim() || undefined,
      });
    }
  };

  const switchTab = (newTab: DateTab) => {
    setTab(newTab);
    setOffset(0);
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="page">
      <h1 className="page-title">Памятные даты</h1>

      <div className="tabs tabs--scroll">
        <button className={`tab ${tab === "upcoming" ? "active" : ""}`} onClick={() => switchTab("upcoming")}>
          Ближайшие
        </button>
        <button className={`tab ${tab === "week" ? "active" : ""}`} onClick={() => switchTab("week")}>
          На неделе
        </button>
        <button className={`tab ${tab === "month" ? "active" : ""}`} onClick={() => switchTab("month")}>
          За месяц
        </button>
        <button className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => switchTab("all")}>
          Все даты
        </button>
      </div>

      {isLoading && <div className="loading">Загрузка...</div>}

      {dates && dates.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎂</div>
          <div className="empty-state-text">
            {tab === "upcoming" ? "Нет ближайших дат"
              : tab === "week" ? "Нет дат на этой неделе"
              : tab === "month" ? "Нет дат в этом месяце"
              : "Нет памятных дат"}
          </div>
        </div>
      )}

      {dates && dates.length > 0 && (
        <div className="list">
          {dates.map((d) => (
            <div key={d.id} className="list-item">
              <span className="list-item-emoji">{d.emoji || "🎂"}</span>
              <div className="list-item-content">
                <div className="list-item-title">{d.name}</div>
                <div className="list-item-hint">
                  {d.dateDay} {MONTHS[d.dateMonth - 1]} &middot; {d.eventType}
                  {d.isPriority ? " ★" : ""}
                </div>
                {d.description && (
                  <div className="list-item-hint" style={{ marginTop: 2 }}>{d.description}</div>
                )}
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-icon"
                  onClick={() => togglePriorityMutation.mutate(d.id)}
                  disabled={togglePriorityMutation.isPending}
                  title={d.isPriority ? "Убрать приоритет" : "Сделать приоритетной"}
                >
                  {d.isPriority ? "🔔" : "🔕"}
                </button>
                <button className="btn btn-icon" onClick={() => startEdit(d)} title="Редактировать">✏️</button>
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => handleDelete(d.id, d.name)}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "all" && total > PAGE_SIZE && (
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

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Название</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя человека или событие" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Месяц</label>
                <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">День</label>
                <input className="input" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Тип</label>
              <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="birthday">День рождения</option>
                <option value="anniversary">Годовщина</option>
                <option value="holiday">Праздник</option>
                <option value="other">Другое</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Описание (необязательно)</label>
              <textarea
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Дополнительная информация"
                rows={2}
              />
            </div>
            {(createMutation.error || updateMutation.error) && (
              <div className="error-msg">{((createMutation.error || updateMutation.error) as Error).message}</div>
            )}
            <div className="form-row">
              <button type="button" className="btn" onClick={resetForm}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={(createMutation.isPending || updateMutation.isPending) || !name.trim()}>
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
