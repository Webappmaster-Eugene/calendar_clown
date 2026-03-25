import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import type { ReminderDto, ReminderScheduleDto, CreateReminderRequest } from "@shared/types";

type ReminderTab = "own" | "tribe";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function formatWeekdays(weekdays: number[]): string {
  if (weekdays.length === 7) return "ежедневно";
  if (weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => weekdays.includes(d))) return "будни";
  if (weekdays.length === 2 && [6, 7].every((d) => weekdays.includes(d))) return "выходные";
  return weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(", ");
}

interface TribeReminderDto extends ReminderDto {
  ownerName: string;
}

export function RemindersPage() {
  const queryClient = useQueryClient();
  const { webApp } = useTelegram();
  const [tab, setTab] = useState<ReminderTab>("own");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [endDate, setEndDate] = useState("");

  const { data: reminders, isLoading, error } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => api.get<ReminderDto[]>("/api/reminders"),
  });

  const { data: tribeReminders, isLoading: tribeLoading } = useQuery({
    queryKey: ["reminders", "tribe"],
    queryFn: () => api.get<TribeReminderDto[]>("/api/reminders/tribe"),
    enabled: tab === "tribe",
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateReminderRequest) =>
      api.post<ReminderDto>("/api/reminders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; text?: string; schedule?: ReminderScheduleDto }) =>
      api.put<void>(`/api/reminders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      resetForm();
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

  const subscribeMutation = useMutation({
    mutationFn: (id: number) => api.post<void>(`/api/reminders/${id}/subscribe`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders", "tribe"] });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/reminders/${id}/subscribe`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders", "tribe"] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setText("");
    setTimes(["09:00"]);
    setWeekdays([1, 2, 3, 4, 5, 6, 7]);
    setEndDate("");
  };

  const startEdit = (r: ReminderDto) => {
    setEditingId(r.id);
    setText(r.text);
    setTimes(r.schedule.times.length > 0 ? [...r.schedule.times] : ["09:00"]);
    setWeekdays([...r.schedule.weekdays]);
    setEndDate(r.schedule.endDate ?? "");
    setShowForm(true);
  };

  const handleDelete = (id: number, reminderText: string) => {
    if (webApp) {
      webApp.showConfirm(`Удалить "${reminderText}"?`, (confirmed) => {
        if (confirmed) deleteMutation.mutate(id);
      });
    } else {
      if (confirm(`Удалить "${reminderText}"?`)) deleteMutation.mutate(id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || times.length === 0 || weekdays.length === 0) return;
    const schedule: ReminderScheduleDto = {
      times: times.filter((t) => t),
      weekdays,
      endDate: endDate || null,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, text: text.trim(), schedule });
    } else {
      createMutation.mutate({ text: text.trim(), schedule });
    }
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const addTime = () => setTimes((prev) => [...prev, "12:00"]);
  const removeTime = (idx: number) => setTimes((prev) => prev.filter((_, i) => i !== idx));
  const updateTime = (idx: number, val: string) =>
    setTimes((prev) => prev.map((t, i) => (i === idx ? val : t)));

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Напоминания</h1>

      <div className="tabs">
        <button className={`tab ${tab === "own" ? "active" : ""}`} onClick={() => setTab("own")}>
          Мои
        </button>
        <button className={`tab ${tab === "tribe" ? "active" : ""}`} onClick={() => setTab("tribe")}>
          Семьи
        </button>
      </div>

      {tab === "tribe" && (
        <>
          {tribeLoading && <div className="loading">Загрузка...</div>}
          {tribeReminders && tribeReminders.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-text">Нет напоминаний от других участников</div>
            </div>
          )}
          {tribeReminders && tribeReminders.length > 0 && (
            <div className="list">
              {tribeReminders.map((r) => (
                <div key={r.id} className="list-item">
                  <div className="list-item-content">
                    <div className="list-item-title">{r.text}</div>
                    <div className="list-item-hint">
                      {r.ownerName} &middot; {r.schedule.times.join(", ")} &middot; {formatWeekdays(r.schedule.weekdays)}
                    </div>
                  </div>
                  <div className="list-item-actions">
                    <button
                      className="btn btn-small btn-primary"
                      onClick={() => subscribeMutation.mutate(r.id)}
                      disabled={subscribeMutation.isPending}
                    >
                      Подписаться
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => unsubscribeMutation.mutate(r.id)}
                      disabled={unsubscribeMutation.isPending}
                    >
                      Отписаться
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "own" && (
        <>
          {reminders && reminders.length === 0 && !showForm && (
            <div className="empty-state">
              <div className="empty-state-emoji">⏰</div>
              <div className="empty-state-text">Нет напоминаний</div>
            </div>
          )}

          {reminders && reminders.length > 0 && (
            <div className="list">
              {reminders.map((r) => (
                <div key={r.id} className="list-item" style={{ flexWrap: "wrap" }}>
                  <button
                    className={`toggle ${r.isActive ? "active" : ""}`}
                    onClick={() => toggleMutation.mutate(r.id)}
                  />
                  <div className="list-item-content">
                    <div className="list-item-title">{r.text}</div>
                    <div className="list-item-hint">
                      {r.schedule.times.join(", ")} &middot; {formatWeekdays(r.schedule.weekdays)}
                      {r.schedule.endDate ? ` &middot; до ${r.schedule.endDate}` : ""}
                      {r.subscribers.length > 0 ? ` &middot; ${r.subscribers.length} подписчик(ов)` : ""}
                    </div>
                  </div>
                  <div className="list-item-actions">
                    <button className="btn btn-small" onClick={() => startEdit(r)}>Ред.</button>
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
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label">Текст</label>
                  <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст напоминания" />
                </div>

                <div className="form-group">
                  <label className="form-label">Время</label>
                  {times.map((t, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                      <input
                        className="input"
                        type="time"
                        value={t}
                        onChange={(e) => updateTime(idx, e.target.value)}
                        style={{ flex: 1 }}
                      />
                      {times.length > 1 && (
                        <button type="button" className="btn btn-small btn-danger" onClick={() => removeTime(idx)}>
                          -
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-small" onClick={addTime} style={{ marginTop: 4 }}>
                    + Добавить время
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">Дни недели</label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const day = idx + 1;
                      const active = weekdays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`btn btn-small ${active ? "btn-primary" : ""}`}
                          onClick={() => toggleWeekday(day)}
                          style={{ minWidth: 40 }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Дата окончания (необязательно)</label>
                  <input
                    className="input"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>

                {(createMutation.error || updateMutation.error) && (
                  <div className="error-msg">
                    {((createMutation.error || updateMutation.error) as Error).message}
                  </div>
                )}
                <div className="form-row">
                  <button type="button" className="btn" onClick={resetForm}>Отмена</button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      (createMutation.isPending || updateMutation.isPending) ||
                      !text.trim() || times.length === 0 || weekdays.length === 0
                    }
                  >
                    {editingId ? "Сохранить" : "Создать"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!showForm && (
            <button className="fab" onClick={() => setShowForm(true)}>+</button>
          )}
        </>
      )}
    </div>
  );
}
