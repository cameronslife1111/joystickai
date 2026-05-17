import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

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
      if (pendingTapTimer) clearTimeout(pendingTapTimer);
    };
  }, [ref, longPressMs, doubleTapMs, swipeThreshold, moveCancelPx]);
}
