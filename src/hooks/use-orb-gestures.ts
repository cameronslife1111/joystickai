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
  /** Change this value to force listeners to re-bind to the current ref.current. */
  rebindKey?: string | number | boolean | null;
}

/**
 * Gesture layer for the orb.
 *
 * Design notes (why it looks like this):
 * - The gesture *starts* on the orb, but move/end are tracked on `window`. The
 *   orb is small; a trackpad or finger drag leaves it long before the swipe
 *   threshold is reached, and relying on pointer capture alone proved fragile
 *   across browsers.
 * - Mouse and touch fallbacks exist for engines where the Pointer Event path
 *   doesn't deliver (or is suppressed). They're ignored whenever a pointer
 *   event was seen for the same interaction, so callbacks never double-fire.
 * - The element is polled for a short while when it isn't mounted yet, without
 *   triggering re-renders.
 */
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
    let disposed = false;
    let cleanup: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const attach = (el: HTMLElement) => {
      let startX = 0;
      let startY = 0;
      let longPressTimer: ReturnType<typeof setTimeout> | null = null;
      let isLongPressing = false;
      let active = false;
      let usingPointer = false;
      let tapCount = 0;
      let tapTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        (el as HTMLElement & { draggable?: boolean }).draggable = false;
      } catch {}

      const clearLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      const begin = (x: number, y: number, pointer: boolean) => {
        if (active) return;
        active = true;
        usingPointer = pointer;
        startX = x;
        startY = y;
        isLongPressing = false;
        longPressTimer = setTimeout(() => {
          isLongPressing = true;
          cbRef.current.onLongPressStart?.();
        }, longPressMs);
      };

      const move = (x: number, y: number) => {
        if (!active) return;
        if (!isLongPressing && Math.hypot(x - startX, y - startY) > moveCancelPx) {
          clearLongPress();
        }
      };

      const finish = (x: number, y: number) => {
        if (!active) return;
        active = false;
        clearLongPress();

        if (isLongPressing) {
          cbRef.current.onLongPressEnd?.();
          isLongPressing = false;
          return;
        }

        const dx = x - startX;
        const dy = y - startY;
        if (Math.hypot(dx, dy) >= swipeThreshold) {
          const dir: SwipeDirection =
            Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
          cbRef.current.onSwipe?.(dir);
          return;
        }

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

      const abort = () => {
        if (!active) return;
        active = false;
        clearLongPress();
        if (isLongPressing) {
          cbRef.current.onLongPressEnd?.();
          isLongPressing = false;
        }
      };

      /* ------------------------- pointer events ------------------------- */
      let activePointerId: number | null = null;

      const onPointerDown = (e: PointerEvent) => {
        // Stop native drag / text selection from stealing the interaction.
        e.preventDefault();
        activePointerId = e.pointerId;
        begin(e.clientX, e.clientY, true);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!usingPointer || e.pointerId !== activePointerId) return;
        move(e.clientX, e.clientY);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (!usingPointer || e.pointerId !== activePointerId) return;
        activePointerId = null;
        finish(e.clientX, e.clientY);
      };
      const onPointerCancel = (e: PointerEvent) => {
        if (!usingPointer || e.pointerId !== activePointerId) return;
        activePointerId = null;
        abort();
      };

      /* -------------------------- mouse fallback ------------------------- */
      const onMouseDown = (e: MouseEvent) => {
        if (usingPointer || active) return;
        e.preventDefault();
        begin(e.clientX, e.clientY, false);
      };
      const onMouseMove = (e: MouseEvent) => {
        if (usingPointer) return;
        move(e.clientX, e.clientY);
      };
      const onMouseUp = (e: MouseEvent) => {
        if (usingPointer) return;
        finish(e.clientX, e.clientY);
      };

      /* -------------------------- touch fallback ------------------------- */
      const onTouchStart = (e: TouchEvent) => {
        if (usingPointer || active) return;
        const t = e.touches[0];
        if (!t) return;
        begin(t.clientX, t.clientY, false);
      };
      const onTouchMove = (e: TouchEvent) => {
        if (usingPointer) return;
        const t = e.touches[0];
        if (!t) return;
        move(t.clientX, t.clientY);
      };
      const onTouchEnd = (e: TouchEvent) => {
        if (usingPointer) return;
        const t = e.changedTouches[0];
        if (!t) return;
        finish(t.clientX, t.clientY);
      };

      const onDragStart = (e: Event) => e.preventDefault();
      const onContextMenu = (e: Event) => e.preventDefault();

      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("mousedown", onMouseDown);
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("dragstart", onDragStart);
      el.addEventListener("contextmenu", onContextMenu);

      // End/move on window: the drag routinely travels outside the orb.
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("touchend", onTouchEnd);
      window.addEventListener("touchcancel", abort);

      return () => {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("mousedown", onMouseDown);
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("dragstart", onDragStart);
        el.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onTouchEnd);
        window.removeEventListener("touchcancel", abort);
        clearLongPress();
        if (tapTimer) clearTimeout(tapTimer);
      };
    };

    // Wait (without re-rendering) for the orb node to exist, and re-bind if the
    // orb is ever replaced by a different element (e.g. leaving the editor).
    let boundEl: HTMLElement | null = null;
    const bind = () => {
      if (disposed) return;
      const el = ref.current;
      if (el && el !== boundEl) {
        cleanup?.();
        boundEl = el;
        cleanup = attach(el);
      } else if (!el && boundEl) {
        cleanup?.();
        cleanup = null;
        boundEl = null;
      }
      pollTimer = setTimeout(bind, 250);
    };
    bind();

    return () => {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      cleanup?.();
    };

  }, [ref, longPressMs, doubleTapMs, swipeThreshold, moveCancelPx, opts.rebindKey]);
}
