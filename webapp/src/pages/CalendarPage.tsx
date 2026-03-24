import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, ApiError } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import type { CalendarEventDto } from "@shared/types";

type Tab = "today" | "week";

export function CalendarPage() {
  const [tab, setTab] = useState<Tab>("today");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { webApp } = useTelegram();

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

  const handleDelete = (eventId: string, summary: string) => {
    if (webApp) {
      webApp.showConfirm(`Удалить "${summary}"?`, (confirmed) => {
        if (confirmed) deleteMutation.mutate(eventId);
      });
    } else {
      if (confirm(`Удалить "${summary}"?`)) {
        deleteMutation.mutate(eventId);
      }
    }
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

      {isLoading && <div className="loading">Загрузка событий...</div>}
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
          {events.map((event) => (
            <div key={event.id} className="list-item">
              <div className="list-item-content">
                <div className="list-item-title">{event.summary}</div>
                <div className="list-item-hint">
                  {formatEventTime(event.start, event.end)}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => handleDelete(event.id, event.summary)}
                  disabled={deleteMutation.isPending}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
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
  const { webApp } = useTelegram();

  const handleLink = async () => {
    setLoading(true);
    try {
      const result = await api.get<{ url: string }>("/api/auth/google/url");
      if (webApp) {
        webApp.openLink(result.url);
      } else {
        window.open(result.url, "_blank");
      }
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
