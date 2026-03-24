import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import type { CreateEventRequest, CreateEventResponse } from "@shared/types";

export function CreateEventPage() {
  const [text, setText] = useState("");
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (data: CreateEventRequest) =>
      api.post<CreateEventResponse>("/api/calendar/events", data),
  });

  useEffect(() => {
    if (!mutation.isSuccess) return;
    const timer = setTimeout(() => navigate("/calendar"), 1500);
    return () => clearTimeout(timer);
  }, [mutation.isSuccess, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    mutation.mutate({ text: trimmed });
  };

  return (
    <div className="page">
      <h1 className="page-title">Новое событие</h1>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Опишите событие</label>
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Встреча с командой завтра в 15:00"
            rows={3}
          />
        </div>

        {mutation.error && (
          <div className="error-msg">{(mutation.error as Error).message}</div>
        )}

        {mutation.isSuccess && mutation.data && (
          <div className="card">
            <div className="card-title">Событие создано</div>
            <div className="card-hint">{mutation.data.event.summary}</div>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={mutation.isPending || !text.trim()}
        >
          {mutation.isPending ? "Создание..." : "Создать событие"}
        </button>
      </form>
    </div>
  );
}
