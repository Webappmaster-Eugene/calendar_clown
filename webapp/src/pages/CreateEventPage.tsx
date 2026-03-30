import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type { CreateEventRequest, CreateEventResponse, VoiceExtractIntentResponse, CalendarIntentEvent } from "@shared/types";

export function CreateEventPage() {
  const [text, setText] = useState("");
  const navigate = useNavigate();

  // Stores LLM-extracted intent from voice input (cleared when user edits text)
  const [extractedEvents, setExtractedEvents] = useState<CalendarIntentEvent[] | null>(null);
  // Tracks the transcript that corresponds to the current extractedEvents
  const voiceTranscriptRef = useRef<string>("");

  const mutation = useMutation({
    mutationFn: (data: CreateEventRequest) =>
      api.post<CreateEventResponse>("/api/calendar/events", data),
  });

  useEffect(() => {
    if (!mutation.isSuccess) return;
    const timer = setTimeout(() => navigate("/calendar"), 1500);
    return () => clearTimeout(timer);
  }, [mutation.isSuccess, navigate]);

  const handleTextChange = (newText: string) => {
    setText(newText);
    // If user manually edits the transcript, invalidate the extracted intent
    if (extractedEvents && newText !== voiceTranscriptRef.current) {
      setExtractedEvents(null);
    }
  };

  const handleVoiceResult = (transcript: string, data?: unknown) => {
    setText(transcript);
    voiceTranscriptRef.current = transcript;

    // VoiceButton passes the full response as second arg: { transcript, intent }
    const response = data as Partial<VoiceExtractIntentResponse> | undefined;
    const intent = response?.intent;
    if (intent?.type === "calendar" && intent.events?.length) {
      setExtractedEvents(intent.events);
    } else {
      setExtractedEvents(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    // If we have pre-extracted intent from voice (and user didn't edit), use it directly
    if (extractedEvents) {
      mutation.mutate({ intent: { events: extractedEvents } });
    } else {
      mutation.mutate({ text: trimmed });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Новое событие</h1>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Опишите событие</label>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              className="input"
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Встреча с командой завтра в 15:00"
              rows={3}
              style={{ flex: 1 }}
            />
            <VoiceButton
              mode="calendar"
              endpoint="/api/voice/extract-intent"
              onResult={handleVoiceResult}
            />
          </div>
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
