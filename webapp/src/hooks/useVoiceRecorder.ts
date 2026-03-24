/**
 * Browser voice recording hook using MediaRecorder API.
 * Records WebM/Opus on Android, MP4/AAC on iOS.
 */
import { useState, useRef, useCallback } from "react";

interface UseVoiceRecorderResult {
  isRecording: boolean;
  isSupported: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  cancelRecording: () => void;
  duration: number;
}

function getPreferredMimeType(): string {
  // Prefer WebM (Chrome/Android), fallback to MP4 (Safari/iOS)
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const isSupported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      const tracks = mediaRecorderRef.current.stream?.getTracks();
      tracks?.forEach((t) => t.stop());
      mediaRecorderRef.current = null;
    }
    chunksRef.current = [];
    setIsRecording(false);
    setDuration(0);
  }, []);

  const startRecording = useCallback(async () => {
    if (!isSupported) throw new Error("MediaRecorder not supported");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getPreferredMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    chunksRef.current = [];
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      resolveRef.current?.(blob);
      resolveRef.current = null;
    };

    recorder.onerror = () => {
      resolveRef.current?.(null);
      resolveRef.current = null;
      cleanup();
    };

    recorder.start(250); // Collect data every 250ms
    setIsRecording(true);
    setDuration(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  }, [isSupported, cleanup]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      mediaRecorderRef.current.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      // Stop mic access
      mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    });
  }, []);

  const cancelRecording = useCallback(() => {
    resolveRef.current = null;
    cleanup();
  }, [cleanup]);

  return {
    isRecording,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
    duration,
  };
}
