/**
 * Hold-to-record voice button.
 * Records audio via MediaRecorder and sends to backend for transcription.
 */
import { useState, useEffect } from "react";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { api } from "../api/client";

/** Derive correct file extension from the actual MIME type of the recording. */
function getExtFromMime(mimeType: string): string {
  if (mimeType.includes("mp4") || mimeType.includes("aac")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

interface VoiceButtonProps {
  /** Called with the transcript (and optional intent/extra data) when processing succeeds. */
  onResult: (transcript: string, data?: unknown) => void;
  onError?: (error: string) => void;
  /** Mode hint sent to the backend (e.g. "expenses", "goals"). */
  mode?: string;
  /**
   * Override the API endpoint that receives the audio FormData.
   * Default: "/api/voice/transcribe"
   * The endpoint must return `{ ok: true, data: { transcript: string, ... } }`.
   */
  endpoint?: string;
  /** When provided, renders a full card row (button + label/hint) with stable layout across states. */
  label?: string;
  /** Hint text shown below the label in idle state. */
  hint?: string;
}

export function VoiceButton({ onResult, onError, mode, endpoint, label, hint }: VoiceButtonProps) {
  const { isRecording, isSupported, startRecording, stopRecording, cancelRecording, releaseStream, duration } = useVoiceRecorder();
  const [isProcessing, setIsProcessing] = useState(false);

  // Release microphone stream when component unmounts
  useEffect(() => {
    return () => { releaseStream(); };
  }, [releaseStream]);

  if (!isSupported) return null;

  const handleStart = async () => {
    try {
      await startRecording();
    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          onError?.("Доступ к микрофону запрещён. Разрешите доступ в настройках Telegram.");
        } else if (err.name === "NotFoundError") {
          onError?.("Микрофон не найден на устройстве.");
        } else {
          onError?.("Не удалось получить доступ к микрофону.");
        }
      } else {
        onError?.("Не удалось получить доступ к микрофону.");
      }
    }
  };

  const handleStop = async () => {
    const blob = await stopRecording();
    if (!blob || blob.size < 100) {
      onError?.("Запись слишком короткая");
      return;
    }

    setIsProcessing(true);
    try {
      const ext = getExtFromMime(blob.type);
      const formData = new FormData();
      formData.append("audio", blob, `voice.${ext}`);
      if (mode) formData.append("mode", mode);

      const url = endpoint ?? "/api/voice/transcribe";
      const result = await api.upload<{ transcript: string; [key: string]: unknown }>(
        url,
        formData
      );
      onResult(result.transcript, result);
    } catch (err) {
      onError?.((err as Error).message || "Ошибка транскрибации");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    cancelRecording();
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ─── Card row mode (with label/hint) — stable layout across states ───

  if (label) {
    if (isProcessing) {
      return (
        <div className="voice-row">
          <div className="voice-row-icon voice-row-icon--processing">
            <span className="voice-spinner" />
          </div>
          <div className="voice-row-content">
            <div className="voice-row-label">Обработка...</div>
          </div>
        </div>
      );
    }

    if (isRecording) {
      return (
        <div className="voice-row">
          <button className="voice-row-icon voice-row-icon--recording" onClick={handleStop} title="Отправить">
            <span className="voice-dot" />
          </button>
          <div className="voice-row-content">
            <div className="voice-row-label">
              Запись <span className="voice-duration">{formatDuration(duration)}</span>
            </div>
            <div className="voice-row-actions">
              <button className="voice-row-send" onClick={handleStop}>Отправить</button>
              <button className="voice-row-cancel" onClick={handleCancel}>Отмена</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="voice-row">
        <button className="voice-row-icon" onClick={handleStart} title="Голосовой ввод">
          🎙
        </button>
        <div className="voice-row-content" onClick={handleStart} style={{ cursor: "pointer" }}>
          <div className="voice-row-label">{label}</div>
          {hint && <div className="voice-row-hint">{hint}</div>}
        </div>
      </div>
    );
  }

  // ─── Inline mode (no label) — compact button for input rows ───

  if (isProcessing) {
    return (
      <button className="btn voice-btn processing" disabled>
        Обработка...
      </button>
    );
  }

  if (isRecording) {
    return (
      <div className="voice-recording">
        <span className="voice-dot" />
        <span className="voice-duration">{formatDuration(duration)}</span>
        <button className="btn voice-btn-stop" onClick={handleStop}>
          Отправить
        </button>
        <button className="btn voice-btn-cancel" onClick={handleCancel}>
          Отмена
        </button>
      </div>
    );
  }

  return (
    <button className="btn voice-btn" onClick={handleStart} title="Голосовой ввод">
      🎙
    </button>
  );
}
