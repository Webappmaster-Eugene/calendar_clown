import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, ApiError } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import type { CalendarEventDto } from "@shared/types";

type Tab = "today" | "week";

interface EditForm {
  title: string;
  start: string;
  end: string;
}

export function CalendarPage() {
  const [tab, setTab] = useState<Tab>("today");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ title: "", start: "", end: "" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showConfirm } = useTelegram();

  const { data: events, isLoading, error } = useQuery({
    queryKey: ["calendar", tab],
    queryFn: () => api.get<CalendarEventDto[]>(`/api/calendar/${tab}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => api.del<void>(`/api/calendar/events/${eventId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; title: string; startISO: string; endISO: string }) =>
      api.put<CalendarEventDto>(`/api/calendar/events/${vars.id}`, {
        title: vars.title,
        startISO: vars.startISO,
        endISO: vars.endISO,
      }),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["calendar", tab] });
    },
  });

  const handleDelete = (eventId: string, summary: string) => {
    showConfirm(`Удалить "${summary}"?`, (confirmed) => {
      if (confirmed) deleteMutation.mutate(eventId);
    });
  };

  const handleStartEdit = (event: CalendarEventDto) => {
    setEditingId(event.id);
    setEditForm({
      title: event.summary,
      start: toDatetimeLocal(event.start),
      end: toDatetimeLocal(event.end),
    });
    updateMutation.reset();
  };

  const handleSaveEdit = (eventId: string) => {
    const title = editForm.title.trim();
    if (!title || !editForm.start || !editForm.end) return;
    updateMutation.mutate({
      id: eventId,
      title,
      startISO: new Date(editForm.start).toISOString(),
      endISO: new Date(editForm.end).toISOString(),
    });
  };

  const isNoCalendar =
    error instanceof ApiError && error.code === "NO_CALENDAR";

  if (isNoCalendar) {
    return <NoCalendarLinked />;
  }

  return (
    <div className="page">
      <h1 className="page-title">Календарь</h1>

      <div className="tabs">
        <button
          className={`tab ${tab === "today" ? "active" : ""}`}
          onClick={() => setTab("today")}
        >
          Сегодня
        </button>
        <button
          className={`tab ${tab === "week" ? "active" : ""}`}
          onClick={() => setTab("week")}
        >
          Неделя
        </button>
      </div>

      {isLoading && <ListSkeleton />}
      {error && !isNoCalendar && (
        <div className="error-msg">{(error as Error).message}</div>
      )}

      {events && events.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-emoji">📭</div>
          <div className="empty-state-text">{tab === "today" ? "На сегодня событий нет" : "На неделю событий нет"}</div>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="list">
          {events.map((event) =>
            editingId === event.id ? (
              <div key={event.id} className="list-item list-item-editing">
                <div className="edit-form">
                  <input
                    className="input"
                    type="text"
                    value={editForm.title}
                    placeholder="Название"
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  />
                  <label className="edit-form-label">
                    Начало
                    <input
                      className="input"
                      type="datetime-local"
                      value={editForm.start}
                      onChange={(e) => setEditForm((f) => ({ ...f, start: e.target.value }))}
                    />
                  </label>
                  <label className="edit-form-label">
                    Конец
                    <input
                      className="input"
                      type="datetime-local"
                      value={editForm.end}
                      onChange={(e) => setEditForm((f) => ({ ...f, end: e.target.value }))}
                    />
                  </label>
                  {updateMutation.error && (
                    <div className="error-msg">{(updateMutation.error as Error).message}</div>
                  )}
                  <div className="edit-form-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleSaveEdit(event.id)}
                      disabled={
                        updateMutation.isPending ||
                        !editForm.title.trim() ||
                        !editForm.start ||
                        !editForm.end
                      }
                    >
                      {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => setEditingId(null)}
                      disabled={updateMutation.isPending}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div key={event.id} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">{event.summary}</div>
                  <div className="list-item-hint">
                    {formatEventTime(event.start, event.end)}
                  </div>
                </div>
                <div className="list-item-actions">
                  <button
                    className="btn btn-icon"
                    onClick={() => handleStartEdit(event)}
                    disabled={deleteMutation.isPending}
                    title="Редактировать"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => handleDelete(event.id, event.summary)}
                    disabled={deleteMutation.isPending}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      <button className="fab" onClick={() => navigate("/calendar/new")}>
        +
      </button>
    </div>
  );
}

function NoCalendarLinked() {
  const [loading, setLoading] = useState(false);
  const { openLink } = useTelegram();

  const handleLink = async () => {
    setLoading(true);
    try {
      const result = await api.get<{ url: string }>("/api/auth/google/url");
      openLink(result.url);
    } catch (err) {
      console.error("Failed to get auth URL:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="empty-state">
        <div className="empty-state-emoji">🔗</div>
        <div className="empty-state-text">
          Google Календарь не привязан. Привяжите его, чтобы начать использовать этот режим.
        </div>
        <button
          className="btn btn-primary"
          onClick={handleLink}
          disabled={loading}
        >
          {loading ? "Загрузка..." : "Привязать календарь"}
        </button>
      </div>
    </div>
  );
}

/**
 * Convert an ISO datetime string to the `YYYY-MM-DDTHH:mm` value expected by
 * `<input type="datetime-local">`, expressed in the user's local wall-clock time.
 */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEventTime(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };
  const dateOpts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
  };

  const dateStr = s.toLocaleDateString("ru-RU", dateOpts);
  const startStr = s.toLocaleTimeString("ru-RU", timeOpts);
  const endStr = e.toLocaleTimeString("ru-RU", timeOpts);

  return `${dateStr}, ${startStr} - ${endStr}`;
}
