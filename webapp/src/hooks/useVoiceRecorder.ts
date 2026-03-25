/**
 * Browser voice recording hook using MediaRecorder API.
 * Records WebM/Opus on Android, MP4/AAC on iOS.
 *
 * Caches the microphone stream to avoid repeated permission prompts.
 * Call releaseStream() on unmount to free the microphone.
 */
import { useState, useRef, useCallback } from "react";

interface UseVoiceRecorderResult {
  isRecording: boolean;
  isSupported: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  cancelRecording: () => void;
  releaseStream: () => void;
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

/** Check if a MediaStream is still active (has at least one live track). */
function isStreamActive(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getAudioTracks().some((t) => t.readyState === "live");
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const isSupported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Release the cached microphone stream. Call on component unmount. */
  const releaseStream = useCallback(() => {
    clearTimer();
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
    resolveRef.current = null;
    setIsRecording(false);
    setDuration(0);
  }, [clearTimer]);

  /** Get or reuse the microphone stream. */
  const getStream = useCallback(async (): Promise<MediaStream> => {
    if (isStreamActive(streamRef.current)) {
      return streamRef.current!;
    }
    // Request new stream — this prompts for permission only if not already granted
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
      },
    });
    streamRef.current = stream;
    return stream;
  }, []);

  const startRecording = useCallback(async () => {
    if (!isSupported) throw new Error("MediaRecorder not supported");

    const stream = await getStream();
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
      clearTimer();
      setIsRecording(false);
      setDuration(0);
    };

    recorder.start(250); // Collect data every 250ms
    setIsRecording(true);
    setDuration(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  }, [isSupported, getStream, clearTimer]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      mediaRecorderRef.current.stop();
      clearTimer();
      // Do NOT stop stream tracks — keep them alive for next recording
      setIsRecording(false);
    });
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    resolveRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    clearTimer();
    chunksRef.current = [];
    setIsRecording(false);
    setDuration(0);
  }, [clearTimer]);

  return {
    isRecording,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
    releaseStream,
    duration,
  };
}
