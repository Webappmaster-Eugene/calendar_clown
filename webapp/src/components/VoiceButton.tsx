/**
 * Hold-to-record voice button.
 * Records audio via MediaRecorder and sends to backend for transcription.
 */
import { useState } from "react";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { api } from "../api/client";

interface VoiceButtonProps {
  onResult: (transcript: string, intent?: unknown) => void;
  onError?: (error: string) => void;
  mode?: string;
}

export function VoiceButton({ onResult, onError, mode }: VoiceButtonProps) {
  const { isRecording, isSupported, startRecording, stopRecording, cancelRecording, duration } = useVoiceRecorder();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isSupported) return null;

  const handleStart = async () => {
    try {
      await startRecording();
    } catch {
      onError?.("Не удалось получить доступ к микрофону");
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
      const formData = new FormData();
      formData.append("audio", blob, "voice.webm");
      if (mode) formData.append("mode", mode);

      const result = await api.upload<{ transcript: string; intent?: unknown }>(
        "/api/voice/transcribe",
        formData
      );
      onResult(result.transcript, result.intent);
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
