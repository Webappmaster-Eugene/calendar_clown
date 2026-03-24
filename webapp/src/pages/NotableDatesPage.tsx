import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { NotableDateDto, CreateNotableDateRequest } from "@shared/types";

const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export function NotableDatesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [eventType, setEventType] = useState("birthday");

  const { data: dates, isLoading, error } = useQuery({
    queryKey: ["notable-dates"],
    queryFn: () => api.get<NotableDateDto[]>("/api/notable-dates"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateNotableDateRequest) =>
      api.post<NotableDateDto>("/api/notable-dates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
      setShowForm(false);
      setName("");
      setDay(1);
      setMonth(1);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/notable-dates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notable-dates"] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      dateMonth: month,
      dateDay: day,
      eventType,
    });
  };

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Памятные даты</h1>

      {dates && dates.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎂</div>
          <div className="empty-state-text">Нет памятных дат</div>
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
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => deleteMutation.mutate(d.id)}
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
