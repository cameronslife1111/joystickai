import type { CSSProperties, MouseEvent, PointerEvent, RefObject } from "react";
import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, FileText, Menu, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The home-screen control cluster: six small glowing orbs with smiley faces
 * arranged around a transparent, pressable center pad.
 *
 *   Layout (grid):
 *                    blue · previous
 *   red · delete   yellow · menu   [center]   green · next doc   orange · pinned doc
 *                    purple · next
 *
 * The center pad is intentionally empty/transparent so the app background
 * shows through; gestures (tap = edit, long-press = record) are attached by
 * the parent via `centerRef` and `useOrbGestures`.
 */

/** Orbs that can be pressed programmatically (keyboard arrows). */
export type OrbId = "prev" | "next" | "menu" | "nextDoc";

interface OrbClusterProps {
  recording: boolean;
  centerRef: RefObject<HTMLDivElement | null>;
  /**
   * Receives an imperative press function so keyboard shortcuts can go through
   * the exact same click path (giggle animation included) as a real press.
   */
  pressRef?: RefObject<((id: OrbId) => void) | null>;
  onPrev: () => void;
  onNext: () => void;
  onMenu: () => void;
  onNextDoc: () => void;
  onDelete: () => void;
  /** Orange orb tap: open the pinned document. */
  onPinnedDoc: () => void;
  /** Orange orb hold: choose a new document to pin. */
  onPinnedDocLongPress: () => void;
}

/** Short, soundless jiggle played on the pressed orb. */
function giggle(el: HTMLButtonElement) {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  try {
    el.animate(
      [
        { transform: "rotate(0deg) scale(1)" },
        { transform: "rotate(-14deg) scale(1.14)" },
        { transform: "rotate(11deg) scale(1.1)" },
        { transform: "rotate(-7deg) scale(1.06)" },
        { transform: "rotate(4deg) scale(1.02)" },
        { transform: "rotate(0deg) scale(1)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  } catch {
    // Web Animations API unavailable — the press still works.
  }
}

const LONG_PRESS_MS = 500;

interface ClusterOrbProps {
  /** Full literal class (e.g. "glow-orb-blue") so Tailwind's scanner sees it. */
  orbClass: string;
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  /** Optional hold action; when it fires, the tap action is suppressed. */
  onLongPress?: () => void;
  placement: CSSProperties;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

function ClusterOrb({
  orbClass,
  Icon,
  label,
  onPress,
  onLongPress,
  placement,
  buttonRef,
}: ClusterOrbProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  /** Small finger drift shouldn't cancel the hold; a real drag should. */
  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!timer.current || !start.current) return;
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 12) clearTimer();
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!onLongPress) return;
    fired.current = false;
    clearTimer();
    start.current = { x: e.clientX, y: e.clientY };
    const el = e.currentTarget;
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      giggle(el);
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    clearTimer();
    if (fired.current) {
      fired.current = false;
      return;
    }
    giggle(e.currentTarget);
    onPress();
  };

  useEffect(() => clearTimer, []);

  return (
    <button
      type="button"
      ref={buttonRef}
      aria-label={label}
      title={label}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerMove={handlePointerMove}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault();
      }}
      className={cn("glow-orb", orbClass)}
      style={placement}
    >
      <Icon className="glow-orb-icon" aria-hidden="true" focusable="false" strokeWidth={2.6} />
    </button>
  );
}

export function OrbCluster({
  recording,
  centerRef,
  pressRef,
  onPrev,
  onNext,
  onMenu,
  onNextDoc,
  onDelete,
  onPinnedDoc,
  onPinnedDocLongPress,
}: OrbClusterProps) {
  const buttons = useRef<Partial<Record<OrbId, HTMLButtonElement | null>>>({});
  const setButton = (id: OrbId) => (el: HTMLButtonElement | null) => {
    buttons.current[id] = el;
  };

  useEffect(() => {
    if (!pressRef) return;
    const ref = pressRef as { current: ((id: OrbId) => void) | null };
    ref.current = (id) => buttons.current[id]?.click();
    return () => {
      ref.current = null;
    };
  }, [pressRef]);

  return (
    <div className="orb-cluster">
      <ClusterOrb
        orbClass="glow-orb-blue"
        Icon={ArrowUp}
        label="Previous sentence"
        onPress={onPrev}
        buttonRef={setButton("prev")}
        placement={{ gridColumn: 3, gridRow: 1 }}
      />
      <ClusterOrb
        orbClass="glow-orb-red"
        Icon={Trash2}
        label="Delete sentence"
        onPress={onDelete}
        placement={{ gridColumn: 1, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-yellow"
        Icon={Menu}
        label="Open menu"
        onPress={onMenu}
        buttonRef={setButton("menu")}
        placement={{ gridColumn: 2, gridRow: 2 }}
      />
      <div
        ref={centerRef}
        role="button"
        tabIndex={-1}
        aria-label="Press to edit document, hold to record a voice idea"
        className={cn("orb-cluster-center", recording && "orb-recording")}
        style={{ gridColumn: 3, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-green"
        Icon={FileText}
        label="Next document"
        onPress={onNextDoc}
        buttonRef={setButton("nextDoc")}
        placement={{ gridColumn: 4, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-orange"
        Icon={Pin}
        label="Open pinned document (hold to pin another)"
        onPress={onPinnedDoc}
        onLongPress={onPinnedDocLongPress}
        placement={{ gridColumn: 5, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-purple"
        Icon={ArrowDown}
        label="Next sentence"
        onPress={onNext}
        buttonRef={setButton("next")}
        placement={{ gridColumn: 3, gridRow: 3 }}
      />
    </div>
  );
}
