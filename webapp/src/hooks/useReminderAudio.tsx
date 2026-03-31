/**
 * Global reminder audio provider.
 * Polls for recently fired reminders with sound enabled and plays audio
 * via Web Audio API when the Mini App is open.
 *
 * This solves the "selected devices" problem: audio plays only
 * on the device where the Mini App is running.
 */

import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from "react";
import { api } from "../api/client";
import type { FiredReminderDto } from "@shared/types";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

interface ReminderAudioContextValue {
  /** Whether AudioContext is unlocked and ready to play. */
  isReady: boolean;
}

const ReminderAudioContext = createContext<ReminderAudioContextValue>({ isReady: false });

export function useReminderAudio(): ReminderAudioContextValue {
  return useContext(ReminderAudioContext);
}

export function ReminderAudioProvider({ children }: { children: ReactNode }) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isUnlockedRef = useRef(false);
  const lastCheckRef = useRef<string>(new Date().toISOString());
  const playedIdsRef = useRef<Set<string>>(new Set());
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const playQueueRef = useRef<FiredReminderDto[]>([]);
  const isPlayingRef = useRef(false);

  // Initialize AudioContext (suspended until user gesture)
  const getAudioContext = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    return audioCtxRef.current;
  }, []);

  // Unlock AudioContext on first user gesture
  useEffect(() => {
    const unlock = async () => {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch { /* ignore */ }
      }
      isUnlockedRef.current = ctx.state === "running";
    };

    const events = ["click", "touchstart", "keydown"] as const;
    const handler = () => {
      unlock();
      for (const e of events) document.removeEventListener(e, handler);
    };
    for (const e of events) document.addEventListener(e, handler, { once: false, passive: true });

    return () => {
      for (const e of events) document.removeEventListener(e, handler);
    };
  }, [getAudioContext]);

  // Fetch and decode audio buffer (with cache)
  const getAudioBuffer = useCallback(async (filename: string): Promise<AudioBuffer | null> => {
    const cached = audioBufferCacheRef.current.get(filename);
    if (cached) return cached;

    const ctx = getAudioContext();
    if (!ctx) return null;

    try {
      const response = await fetch(`/api/reminders/sounds/file/${filename}`);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      audioBufferCacheRef.current.set(filename, audioBuffer);
      return audioBuffer;
    } catch {
      return null;
    }
  }, [getAudioContext]);

  // Play a single audio buffer
  const playBuffer = useCallback(async (buffer: AudioBuffer): Promise<void> => {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return;

    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      source.start();
    });
  }, [getAudioContext]);

  // Process play queue sequentially
  const processQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    while (playQueueRef.current.length > 0) {
      const item = playQueueRef.current.shift();
      if (!item) break;

      const buffer = await getAudioBuffer(item.soundFile);
      if (buffer) {
        await playBuffer(buffer);
      }
    }

    isPlayingRef.current = false;
  }, [getAudioBuffer, playBuffer]);

  // Poll for fired reminders
  useEffect(() => {
    const poll = async () => {
      const since = lastCheckRef.current;
      lastCheckRef.current = new Date().toISOString();

      try {
        const fired = await api.get<FiredReminderDto[]>(`/api/reminders/fired?since=${since}`);

        for (const reminder of fired) {
          const key = `${reminder.id}-${reminder.firedAt}`;
          if (!playedIdsRef.current.has(key)) {
            playedIdsRef.current.add(key);
            playQueueRef.current.push(reminder);
          }
        }

        if (playQueueRef.current.length > 0) {
          processQueue();
        }
      } catch {
        // Network error — skip, retry on next interval
      }

      // Cleanup old played IDs (keep last 100)
      if (playedIdsRef.current.size > 100) {
        const arr = Array.from(playedIdsRef.current);
        playedIdsRef.current = new Set(arr.slice(-50));
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    // Initial poll after short delay (let AudioContext initialize)
    const timeoutId = setTimeout(poll, 3_000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [processQueue]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  return (
    <ReminderAudioContext.Provider value={{ isReady: isUnlockedRef.current }}>
      {children}
    </ReminderAudioContext.Provider>
  );
}
