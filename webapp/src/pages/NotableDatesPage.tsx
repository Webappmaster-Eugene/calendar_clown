import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import type { NotableDateDto, CreateNotableDateRequest } from "@shared/types";

const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

type DateTab = "upcoming" | "all";

export function NotableDatesPage() {
  const queryClient = useQueryClient();
  const { webApp } = useTelegram();
  const [tab, setTab] = useState<DateTab>("upcoming");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [day, setDay] = useState(1);
  const [eventType, setEventType] = useState("birthday");
  const [description, setDescription] = useState("");

  const { data: upcomingDates, isLoading: upcomingLoading } = useQuery({
    queryKey: ["notable-dates", "upcoming"],
    queryFn: () => api.get<NotableDateDto[]>("/api/notable-dates/upcoming"),
    enabled: tab === "upcoming",
  });

  const { data: allDatesResponse, isLoading: allLoading } = useQuery({
    queryKey: ["notable-dates", "all"],
    queryFn: () => api.get<{ dates: NotableDateDto[]; total: number }>("/api/notable-dates"),
    enabled: tab === "all",
  });

  const dates = tab === "upcoming" ? upcomingDates : allDatesResponse?.dates;
  const isLoading = tab === "upcoming" ? upcomingLoading : allLoading;

  const createMutation = useMutation({
    mutationFn: (data: CreateNotableDateRequest) =>
      api.post<NotableDateDto>("/api/notable-dates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
      setShowForm(false);
      setName("");
      setDay(1);
      setDescription("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/notable-dates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
    },
  });

  const handleDelete = (id: number, dateName: string) => {
    if (webApp) {
      webApp.showConfirm(`Удалить "${dateName}"?`, (confirmed: boolean) => {
        if (confirmed) deleteMutation.mutate(id);
      });
    } else {
      if (confirm(`Удалить "${dateName}"?`)) deleteMutation.mutate(id);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      dateMonth: month,
      dateDay: day,
      eventType,
      description: description.trim() || undefined,
    });
  };

  return (
    <div className="page">
      <h1 className="page-title">Памятные даты</h1>

      <div className="tabs">
        <button className={`tab ${tab === "upcoming" ? "active" : ""}`} onClick={() => setTab("upcoming")}>
          Ближайшие
        </button>
        <button className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          Все даты
        </button>
      </div>

      {isLoading && <div className="loading">Загрузка...</div>}

      {dates && dates.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎂</div>
          <div className="empty-state-text">
            {tab === "upcoming" ? "Нет ближайших дат" : "Нет памятных дат"}
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
                  className="btn btn-danger btn-small"
                  onClick={() => handleDelete(d.id, d.name)}
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
          <form onSubmit={handleCreate}>
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
