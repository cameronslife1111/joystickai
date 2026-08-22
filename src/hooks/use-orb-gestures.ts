import { useEffect, useRef, useState } from "react";

export type SwipeDirection = "up" | "down" | "left" | "right";

interface OrbGestureCallbacks {
  onTap?: () => void;
  onDoubleTap?: () => void;
  onTripleTap?: () => void;
  onLongPressStart?: () => void;
  onLongPressEnd?: () => void;
  onSwipe?: (direction: SwipeDirection) => void;
}

interface Options {
  longPressMs?: number;
  doubleTapMs?: number;
  swipeThreshold?: number;
  moveCancelPx?: number;
  /** Change this value to force listeners to re-bind to the current ref.current. */
  rebindKey?: string | number | boolean | null;
  /**
   * Desktop input: trackpad two-finger swipes (wheel events) and arrow keys map
   * onto the same four swipe callbacks. Returns false while a dialog/editor is
   * open so desktop input can't fire behind an overlay.
   */
  desktopGuard?: () => boolean;
  /** Set false to disable wheel/arrow-key swipes entirely. */
  desktopInput?: boolean;
}


export function useOrbGestures(
  ref: React.RefObject<HTMLElement | null>,
  cb: OrbGestureCallbacks,
  opts: Options = {},
) {
  const longPressMs = opts.longPressMs ?? 500;
  const doubleTapMs = opts.doubleTapMs ?? 280;
  const swipeThreshold = opts.swipeThreshold ?? 40;
  const moveCancelPx = opts.moveCancelPx ?? 12;

  const cbRef = useRef(cb);
  cbRef.current = cb;

  // Safety net: if the element isn't mounted yet when the effect runs, retry on
  // the next frame so listeners always end up attached to the live node. Capped
  // so a deliberately-unmounted orb (editor open) can't re-render every frame.
  const [retry, setRetry] = useState(0);
  const retriesRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      if (retriesRef.current >= 5) return;
      retriesRef.current += 1;
      const raf = requestAnimationFrame(() => setRetry((n) => n + 1));
      return () => cancelAnimationFrame(raf);
    }
    retriesRef.current = 0;



    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let isLongPressing = false;
    let pointerActive = false;
    let tapCount = 0;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    let activePointerId: number | null = null;

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (pointerActive) return;
      pointerActive = true;
      activePointerId = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      isLongPressing = false;

      longPressTimer = setTimeout(() => {
        isLongPressing = true;
        cbRef.current.onLongPressStart?.();
      }, longPressMs);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerActive || e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!isLongPressing && Math.hypot(dx, dy) > moveCancelPx) {
        clearLongPress();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointerActive || e.pointerId !== activePointerId) return;
      pointerActive = false;
      activePointerId = null;
      el.releasePointerCapture?.(e.pointerId);
      clearLongPress();

      if (isLongPressing) {
        cbRef.current.onLongPressEnd?.();
        isLongPressing = false;
        return;
      }

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dist = Math.hypot(dx, dy);

      if (dist >= swipeThreshold) {
        let dir: SwipeDirection;
        if (Math.abs(dx) > Math.abs(dy)) {
          dir = dx > 0 ? "right" : "left";
        } else {
          dir = dy > 0 ? "down" : "up";
        }
        cbRef.current.onSwipe?.(dir);
        return;
      }

      // Tap counting: single / double / triple
      tapCount += 1;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        const n = tapCount;
        tapCount = 0;
        tapTimer = null;
        if (n === 1) cbRef.current.onTap?.();
        else if (n === 2) cbRef.current.onDoubleTap?.();
        else cbRef.current.onTripleTap?.();
      }, doubleTapMs);
    };

    const onPointerCancel = () => {
      pointerActive = false;
      activePointerId = null;
      clearLongPress();
      if (isLongPressing) {
        cbRef.current.onLongPressEnd?.();
        isLongPressing = false;
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      clearLongPress();
      if (tapTimer) clearTimeout(tapTimer);
    };
  }, [ref, longPressMs, doubleTapMs, swipeThreshold, moveCancelPx, opts.rebindKey, retry]);

  // ---- Desktop: trackpad two-finger swipes + arrow keys ------------------
  // Mac trackpads never produce a pointer drag for a swipe — they emit a burst
  // of wheel events — so laptops otherwise have no way to trigger the gestures.
  const desktopInput = opts.desktopInput ?? true;
  const guardRef = useRef(opts.desktopGuard);
  guardRef.current = opts.desktopGuard;

  useEffect(() => {
    if (!desktopInput || typeof window === "undefined") return;

    const allowed = () => (guardRef.current ? guardRef.current() !== false : true);

    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.closest) return false;
      return !!el.closest("input, textarea, select, [contenteditable='true']");
    };

    let ax = 0;
    let ay = 0;
    let lastWheel = 0;
    let cooldownUntil = 0;
    const WHEEL_THRESHOLD = 70;

    const onWheel = (e: WheelEvent) => {
      if (!allowed() || isTyping(e.target)) return;
      const now = Date.now();
      if (now < cooldownUntil) return;
      if (now - lastWheel > 250) {
        ax = 0;
        ay = 0;
      }
      lastWheel = now;
      ax += e.deltaX;
      ay += e.deltaY;
      if (Math.abs(ax) < WHEEL_THRESHOLD && Math.abs(ay) < WHEEL_THRESHOLD) return;
      // deltas follow finger direction: fingers up => deltaY > 0.
      const dir: SwipeDirection =
        Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? "left" : "right") : ay > 0 ? "up" : "down";
      ax = 0;
      ay = 0;
      cooldownUntil = now + 450;
      cbRef.current.onSwipe?.(dir);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!allowed() || isTyping(e.target)) return;
      let dir: SwipeDirection | null = null;
      if (e.key === "ArrowUp") dir = "up";
      else if (e.key === "ArrowDown") dir = "down";
      else if (e.key === "ArrowLeft") dir = "left";
      else if (e.key === "ArrowRight") dir = "right";
      if (!dir) return;
      e.preventDefault();
      cbRef.current.onSwipe?.(dir);
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [desktopInput]);
}
