// Caches the microphone stream to avoid repeated permission prompts; the stream is
// released a few seconds after recording ends (so the OS mic indicator doesn't stay
// lit for the whole session) and on unmount via releaseStream().
import { useState, useRef, useCallback, useEffect } from "react";

// Recording cap. Load-bearing: it keeps uploads inside the <5MB size class, whose
// server-side STT timeout (180s) must stay below api.upload's timeout, which must
// stay below VoiceButton's watchdog. Change all four together or long recordings
// start failing again.
export const MAX_RECORDING_MS = 120_000;

const IDLE_STREAM_RELEASE_MS = 5_000;
// MediaRecorder.onstop can silently never fire in some WebViews; without this the
// stop promise would hang forever and the button would stay in "processing".
const STOP_TIMEOUT_MS = 3_000;

export interface StopRecordingResult {
  blob: Blob | null;
  /** Set when the recorder itself failed, so callers don't blame a short recording. */
  error: string | null;
  /** True when MAX_RECORDING_MS forced the stop. */
  autoStopped: boolean;
}

interface UseVoiceRecorderResult {
  isRecording: boolean;
  isSupported: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<StopRecordingResult>;
  cancelRecording: () => void;
  releaseStream: () => void;
  duration: number;
}

function getPreferredMimeType(): string {
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

function isStreamActive(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getAudioTracks().some((t) => t.readyState === "live");
}

export interface UseVoiceRecorderOptions {
  /** Called when MAX_RECORDING_MS forced the stop, so the caller can send what was
   *  recorded instead of leaving the clip stranded. */
  onAutoStop?: () => void;
}

export function useVoiceRecorder(opts?: UseVoiceRecorderOptions): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((result: StopRecordingResult) => void) | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleReleaseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false);
  const autoStopCbRef = useRef<(() => void) | undefined>(opts?.onAutoStop);
  autoStopCbRef.current = opts?.onAutoStop;
  const recorderErrorRef = useRef<string | null>(null);
  const autoStoppedRef = useRef(false);

  const isSupported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearStopTimeout = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  }, []);

  const cancelIdleRelease = useCallback(() => {
    if (idleReleaseRef.current) {
      clearTimeout(idleReleaseRef.current);
      idleReleaseRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    clearTimer();
    clearStopTimeout();
    cancelIdleRelease();
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      mediaRecorderRef.current = null;
    }
    stopTracks();
    chunksRef.current = [];
    resolveRef.current = null;
    setIsRecording(false);
    setDuration(0);
  }, [clearTimer, clearStopTimeout, cancelIdleRelease, stopTracks]);

  useEffect(() => cancelIdleRelease, [cancelIdleRelease]);

  const scheduleIdleRelease = useCallback(() => {
    cancelIdleRelease();
    idleReleaseRef.current = setTimeout(() => {
      idleReleaseRef.current = null;
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
        stopTracks();
      }
    }, IDLE_STREAM_RELEASE_MS);
  }, [cancelIdleRelease, stopTracks]);

  const getStream = useCallback(async (): Promise<MediaStream> => {
    cancelIdleRelease();
    if (isStreamActive(streamRef.current)) {
      return streamRef.current!;
    }
    // prompts for permission only if not already granted
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
  }, [cancelIdleRelease]);

  const finishStop = useCallback((result: StopRecordingResult) => {
    clearStopTimeout();
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(result);
  }, [clearStopTimeout]);

  const startRecording = useCallback(async () => {
    if (!isSupported) throw new Error("MediaRecorder not supported");
    // A second recorder on the same stream would wipe the first one's chunks.
    if (startingRef.current || mediaRecorderRef.current?.state === "recording") return;

    startingRef.current = true;
    try {
      const stream = await getStream();
      const mimeType = getPreferredMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorderErrorRef.current = null;
      autoStoppedRef.current = false;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        finishStop({
          blob,
          error: recorderErrorRef.current,
          autoStopped: autoStoppedRef.current,
        });
      };

      recorder.onerror = () => {
        recorderErrorRef.current = "Ошибка записи звука. Попробуйте ещё раз.";
        finishStop({ blob: null, error: recorderErrorRef.current, autoStopped: false });
        clearTimer();
        setIsRecording(false);
        setDuration(0);
        scheduleIdleRelease();
      };

      recorder.start(250);
      setIsRecording(true);
      setDuration(0);

      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        setDuration(Math.floor(elapsed / 1000));
        if (elapsed >= MAX_RECORDING_MS && recorder.state === "recording") {
          autoStoppedRef.current = true;
          clearTimer();
          try { recorder.stop(); } catch { /* ignore */ }
          setIsRecording(false);
          // Hand the clip to the caller — otherwise the recording would just vanish.
          autoStopCbRef.current?.();
        }
      }, 1000);
    } finally {
      startingRef.current = false;
    }
  }, [isSupported, getStream, clearTimer, finishStop, scheduleIdleRelease]);

  const stopRecording = useCallback((): Promise<StopRecordingResult> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;

      // The cap may have already stopped the recorder — its onstop still owes us a blob.
      if (recorder && recorder.state === "inactive" && autoStoppedRef.current && chunksRef.current.length > 0) {
        resolve({
          blob: new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }),
          error: recorderErrorRef.current,
          autoStopped: true,
        });
        scheduleIdleRelease();
        return;
      }

      if (!recorder || recorder.state !== "recording") {
        resolve({ blob: null, error: recorderErrorRef.current, autoStopped: autoStoppedRef.current });
        return;
      }

      resolveRef.current = resolve;
      stopTimeoutRef.current = setTimeout(() => {
        stopTimeoutRef.current = null;
        const pending = resolveRef.current;
        resolveRef.current = null;
        pending?.({ blob: null, error: "Не удалось завершить запись. Попробуйте ещё раз.", autoStopped: false });
      }, STOP_TIMEOUT_MS);

      try {
        recorder.stop();
      } catch {
        finishStop({ blob: null, error: "Не удалось завершить запись. Попробуйте ещё раз.", autoStopped: false });
      }
      clearTimer();
      // Tracks stay alive briefly so a follow-up recording doesn't re-prompt.
      scheduleIdleRelease();
      setIsRecording(false);
    });
  }, [clearTimer, finishStop, scheduleIdleRelease]);

  const cancelRecording = useCallback(() => {
    resolveRef.current = null;
    clearStopTimeout();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    clearTimer();
    chunksRef.current = [];
    setIsRecording(false);
    setDuration(0);
    scheduleIdleRelease();
  }, [clearTimer, clearStopTimeout, scheduleIdleRelease]);

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
