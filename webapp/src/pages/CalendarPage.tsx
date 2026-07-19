import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, ApiError } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { VoiceButton } from "../components/VoiceButton";
import type { CalendarEventDto, VoiceExtractIntentResponse } from "@shared/types";

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
  // Voice "покажи расписание": a resolved list_range window overrides the today/week tabs.
  const [voiceRange, setVoiceRange] = useState<{ from: string; days: number; label: string } | null>(null);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showConfirm } = useTelegram();

  const { data: events, isLoading, error } = useQuery({
    queryKey: ["calendar", tab],
    queryFn: () => api.get<CalendarEventDto[]>(`/api/calendar/${tab}`),
    enabled: !voiceRange,
  });

  const { data: rangeEvents, isLoading: rangeLoading, error: rangeError } = useQuery({
    queryKey: ["calendar", "range", voiceRange?.from, voiceRange?.days],
    queryFn: () =>
      api.get<CalendarEventDto[]>(
        `/api/calendar/range?from=${encodeURIComponent(voiceRange!.from)}&days=${voiceRange!.days}`
      ),
    enabled: !!voiceRange,
  });

  const handleVoiceSchedule = (_transcript: string, data?: unknown) => {
    setVoiceMsg(null);
    const intent = (data as Partial<VoiceExtractIntentResponse> | undefined)?.intent;
    if (intent?.type === "list_range" && intent.listFrom) {
      setEditingId(null);
      setVoiceRange({
        from: intent.listFrom,
        days: intent.listDays ?? 1,
        label: intent.listLabel ?? "Расписание",
      });
    } else {
      setVoiceMsg("Скажите, что показать — например «что у меня завтра» или «расписание на неделю».");
    }
  };

  const exitVoice = () => {
    setVoiceRange(null);
    setVoiceMsg(null);
  };

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
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
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

  const inVoice = !!voiceRange;
  const displayEvents = inVoice ? rangeEvents : events;
  const displayLoading = inVoice ? rangeLoading : isLoading;
  const displayError = inVoice ? rangeError : error;

  const isNoCalendar =
    displayError instanceof ApiError && displayError.code === "NO_CALENDAR";

  if (isNoCalendar) {
    return <NoCalendarLinked />;
  }

  return (
    <div className="page">
      <h1 className="page-title">Календарь</h1>

      <div className="tabs">
        <button
          className={`tab ${!inVoice && tab === "today" ? "active" : ""}`}
          onClick={() => { exitVoice(); setTab("today"); }}
        >
          Сегодня
        </button>
        <button
          className={`tab ${!inVoice && tab === "week" ? "active" : ""}`}
          onClick={() => { exitVoice(); setTab("week"); }}
        >
          Неделя
        </button>
      </div>

      <VoiceButton
        endpoint="/api/voice/extract-intent"
        onResult={handleVoiceSchedule}
        onError={(msg) => setVoiceMsg(msg)}
        label="🎤 Покажи расписание"
        hint="Например: «что у меня завтра» или «расписание на неделю»"
      />

      {voiceMsg && <div className="card-hint" style={{ marginTop: 8 }}>{voiceMsg}</div>}

      {inVoice && (
        <div className="list-item" style={{ marginTop: 8 }}>
          <div className="list-item-content">
            <div className="list-item-title">🎤 {voiceRange!.label}</div>
            <div className="list-item-hint">Голосовой запрос</div>
          </div>
          <button className="btn btn-small" onClick={exitVoice}>✕ Обычный вид</button>
        </div>
      )}

      {displayLoading && <ListSkeleton />}
      {displayError && !isNoCalendar && (
        <div className="error-msg">{(displayError as Error).message}</div>
      )}

      {displayEvents && displayEvents.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-emoji">📭</div>
          <div className="empty-state-text">
            {inVoice ? `На «${voiceRange!.label}» событий нет` : tab === "today" ? "На сегодня событий нет" : "На неделю событий нет"}
          </div>
        </div>
      )}

      {displayEvents && displayEvents.length > 0 && (
        <div className="list">
          {displayEvents.map((event) =>
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
