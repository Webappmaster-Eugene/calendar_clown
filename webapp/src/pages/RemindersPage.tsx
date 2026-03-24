import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import type { ReminderDto, CreateReminderRequest } from "@shared/types";

export function RemindersPage() {
  const queryClient = useQueryClient();
  const { webApp } = useTelegram();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [time, setTime] = useState("09:00");

  const { data: reminders, isLoading, error } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => api.get<ReminderDto[]>("/api/reminders"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateReminderRequest) =>
      api.post<ReminderDto>("/api/reminders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      setShowForm(false);
      setText("");
      setTime("09:00");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) =>
      api.put<ReminderDto>(`/api/reminders/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/reminders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
  });

  const handleDelete = (id: number, reminderText: string) => {
    if (webApp) {
      webApp.showConfirm(`Удалить "${reminderText}"?`, (confirmed) => {
        if (confirmed) deleteMutation.mutate(id);
      });
    } else {
      if (confirm(`Удалить "${reminderText}"?`)) {
        deleteMutation.mutate(id);
      }
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    createMutation.mutate({
      text: text.trim(),
      schedule: { times: [time], weekdays: [1, 2, 3, 4, 5, 6, 7], endDate: null },
    });
  };

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Напоминания</h1>

      {reminders && reminders.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">⏰</div>
          <div className="empty-state-text">Нет напоминаний</div>
        </div>
      )}

      {reminders && reminders.length > 0 && (
        <div className="list">
          {reminders.map((r) => (
            <div key={r.id} className="list-item">
              <button
                className={`toggle ${r.isActive ? "active" : ""}`}
                onClick={() => toggleMutation.mutate(r.id)}
              />
              <div className="list-item-content">
                <div className="list-item-title">{r.text}</div>
                <div className="list-item-hint">
                  {r.schedule.times.join(", ")}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => handleDelete(r.id, r.text)}
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
              <label className="form-label">Текст</label>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст напоминания" />
            </div>
            <div className="form-group">
              <label className="form-label">Время</label>
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            {createMutation.error && <div className="error-msg">{(createMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || !text.trim()}>
                {createMutation.isPending ? "Создание..." : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <button className="fab" onClick={() => setShowForm(true)}>+</button>
      )}
    </div>
  );
}
