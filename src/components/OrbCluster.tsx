import type { CSSProperties, MouseEvent, PointerEvent, RefObject } from "react";
import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Image, Menu, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The home-screen control cluster: eight small glowing icon orbs arranged
 * around a transparent, pressable center pad.
 *
 *   Layout (grid):
 *   red · delete      [ ]     blue · previous      [ ]      orange · pinned doc
 *   [ ]            yellow · menu   [center]   green · next doc            [ ]
 *   pink · move/jump  [ ]     purple · next        [ ]      gray · media/chat (hold)
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
  /** Green orb hold: open the Link this sentence popup (slot 18). */
  onNextDocLongPress: () => void;
  onDelete: () => void;
  /** Red orb hold: open Search docs (never deletes). */
  onDeleteLongPress: () => void;
  /** Blue orb hold: toggle the list-cycling lock (slot 22). */
  onPrevLongPress: () => void;
  /** Yellow orb hold: open the New idea composer. */
  onMenuLongPress: () => void;
  /** Purple orb hold: delegate the current step to Orby (menu slot 15). */
  onNextLongPress: () => void;
  /** Orange orb tap: open the pinned document. */
  onPinnedDoc: () => void;
  /** Orange orb hold: open Search docs. */
  onPinnedDocLongPress: () => void;
  /** Pink orb tap: open the Move sentence sheet. */
  onMoveSentence: () => void;
  /** Pink orb hold: open the Jump to sheet. */
  onJumpTo: () => void;
  /** Gray orb tap: open the media gallery. */
  onMediaGallery: () => void;
  /** Gray orb hold: open Chat. */
  onChat: () => void;
  /** Badge count shown on the gray orb (unseen media). */
  grayBadge?: number;
  /** When true, the orange orb is visually disabled and its actions are blocked. */
  lockFavorites?: boolean;
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
  Icon?: LucideIcon;
  /** Rendered instead of an icon (e.g. the letter "J"). */
  glyph?: string;
  badge?: number;
  label: string;
  onPress: () => void;
  /** Optional hold action; when it fires, the tap action is suppressed. */
  onLongPress?: () => void;
  placement: CSSProperties;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  /** When true, the orb is non-interactive and visually dimmed. */
  disabled?: boolean;
}

function ClusterOrb({
  orbClass,
  Icon,
  glyph,
  badge,
  label,
  onPress,
  onLongPress,
  placement,
  buttonRef,
  disabled,
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
    if (disabled || !onLongPress) return;
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
    if (disabled) return;
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
      disabled={disabled}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerMove={handlePointerMove}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault();
      }}
      className={cn("glow-orb", orbClass, disabled && "opacity-40 grayscale")}
      style={placement}
    >
      {Icon ? (
        <Icon className="glow-orb-icon" aria-hidden="true" focusable="false" strokeWidth={2.6} />
      ) : (
        <span className="glow-orb-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      {badge && badge > 0 ? (
        <span className="glow-orb-badge">{badge > 99 ? "99+" : badge}</span>
      ) : null}
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
  onNextDocLongPress,
  onDelete,
  onPrevLongPress,
  onMenuLongPress,
  onNextLongPress,
  onPinnedDoc,
  onPinnedDocLongPress,
  onMoveSentence,
  onJumpTo,
  onMediaGallery,
  onChat,
  grayBadge,
  lockFavorites,
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
        label="Previous sentence (hold to lock/unlock list)"
        onPress={onPrev}
        onLongPress={onPrevLongPress}
        buttonRef={setButton("prev")}
        placement={{ gridColumn: 3, gridRow: 1 }}
      />
      <ClusterOrb
        orbClass="glow-orb-red"
        Icon={Trash2}
        label="Delete sentence"
        onPress={onDelete}
        placement={{ gridColumn: 1, gridRow: 1 }}
      />
      <ClusterOrb
        orbClass="glow-orb-yellow"
        Icon={Menu}
        label="Open menu (hold for New idea)"
        onPress={onMenu}
        onLongPress={onMenuLongPress}
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
        label="Next document (hold to link this sentence)"
        onPress={onNextDoc}
        onLongPress={onNextDocLongPress}
        buttonRef={setButton("nextDoc")}
        placement={{ gridColumn: 4, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-orange"
        Icon={Pin}
        label="Open pinned document (hold to search docs)"
        onPress={onPinnedDoc}
        onLongPress={onPinnedDocLongPress}
        disabled={lockFavorites}
        placement={{ gridColumn: 5, gridRow: 1 }}
      />
      <ClusterOrb
        orbClass="glow-orb-purple"
        Icon={ArrowDown}
        label="Next sentence (hold to delegate)"
        onPress={onNext}
        onLongPress={onNextLongPress}
        buttonRef={setButton("next")}
        placement={{ gridColumn: 3, gridRow: 3 }}
      />
      <ClusterOrb
        orbClass="glow-orb-pink"
        Icon={ArrowUpDown}
        label="Move sentence (hold to jump to)"
        onPress={onMoveSentence}
        onLongPress={onJumpTo}
        placement={{ gridColumn: 1, gridRow: 3 }}
      />
      <ClusterOrb
        orbClass="glow-orb-gray"
        Icon={Image}
        label="Media gallery (hold for chat)"
        badge={grayBadge}
        onPress={onMediaGallery}
        onLongPress={onChat}
        placement={{ gridColumn: 5, gridRow: 3 }}
      />
    </div>
  );
}
