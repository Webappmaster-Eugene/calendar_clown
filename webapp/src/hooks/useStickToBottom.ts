import { useCallback, useEffect, useRef, useState } from "react";

/** Past this distance from the bottom the reader is treated as having left. */
const DETACH_THRESHOLD_PX = 120;
/** Re-attaching needs a deliberate return to the very bottom — a wider band
 *  would snap the view back while the finger is still dragging away. */
const REATTACH_THRESHOLD_PX = 24;
/** Vertical finger travel that counts as "scroll up", not a tap wobble. */
const TOUCH_INTENT_PX = 4;

export interface UseStickToBottomResult<T extends HTMLElement> {
  /** Attach to the element whose growth should drive the auto-scroll. */
  containerRef: (node: T | null) => void;
  /** False while the reader has scrolled away from the bottom. */
  pinned: boolean;
  /** Jump back down and resume following. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

function distanceFromBottom(): number {
  return (
    document.documentElement.scrollHeight - window.scrollY - window.innerHeight
  );
}

/**
 * Follows growing content only while the reader is already at the bottom.
 * Scrolling up detaches the view, and nothing pulls it back down until the
 * reader returns to the bottom or asks for it — so a streaming answer never
 * yanks the screen away from the paragraph being read.
 */
export function useStickToBottom<
  T extends HTMLElement,
>(): UseStickToBottomResult<T> {
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const observerRef = useRef<ResizeObserver | null>(null);

  const setPinnedState = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "instant") => {
      setPinnedState(true);
      // "auto" resolves to the global `scroll-behavior: smooth`, and an
      // animation restarted on every chunk is exactly the jitter we avoid here.
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
    },
    [setPinnedState],
  );

  useEffect(() => {
    // An instant programmatic scroll lands at the bottom before this fires, so
    // its own event re-confirms the pin instead of cancelling it.
    const onScroll = () => {
      const distance = distanceFromBottom();
      if (distance > DETACH_THRESHOLD_PX) setPinnedState(false);
      else if (distance <= REATTACH_THRESHOLD_PX) setPinnedState(true);
    };

    // A scroll event can lose the race with the next content resize, which would
    // snap the view back before the drag is even registered. The gesture itself
    // is the earlier and unambiguous signal, so detaching keys off that.
    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y == null || touchY == null) return;
      if (y - touchY > TOUCH_INTENT_PX) setPinnedState(false);
      touchY = y;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) setPinnedState(false);
    };

    const passive = { passive: true } as const;
    window.addEventListener("scroll", onScroll, passive);
    window.addEventListener("resize", onScroll, passive);
    window.addEventListener("touchstart", onTouchStart, passive);
    window.addEventListener("touchmove", onTouchMove, passive);
    window.addEventListener("wheel", onWheel, passive);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("wheel", onWheel);
    };
  }, [setPinnedState]);

  const containerRef = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || typeof ResizeObserver === "undefined") return;

      // Content height, not React state, is the real trigger: markdown, images
      // and streamed chunks all land as a resize of the same container.
      const observer = new ResizeObserver(() => {
        if (pinnedRef.current) scrollToBottom();
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [scrollToBottom],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { containerRef, pinned, scrollToBottom };
}
