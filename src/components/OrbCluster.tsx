import type { CSSProperties, MouseEvent, RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * The home-screen control cluster: six small glowing orbs with smiley faces
 * arranged around a transparent, pressable center pad.
 *
 *   Layout (grid):
 *                    blue · previous
 *   red · delete   yellow · menu   [center]   green · next doc   orange · repeat
 *                    purple · next
 *
 * The center pad is intentionally empty/transparent so the app background
 * shows through; gestures (tap = edit, long-press = record) are attached by
 * the parent via `centerRef` and `useOrbGestures`.
 */

interface OrbClusterProps {
  recording: boolean;
  centerRef: RefObject<HTMLDivElement | null>;
  onPrev: () => void;
  onNext: () => void;
  onMenu: () => void;
  onNextDoc: () => void;
  onDelete: () => void;
  onRepeat: () => void;
}

type OrbColor = "red" | "orange" | "blue" | "purple" | "green" | "yellow";

/** Little smiley face drawn on every orb. */
function Smiley() {
  return (
    <svg viewBox="0 0 24 24" className="glow-orb-face" aria-hidden focusable="false">
      <circle cx="8.5" cy="9.5" r="1.7" fill="currentColor" />
      <circle cx="15.5" cy="9.5" r="1.7" fill="currentColor" />
      <path
        d="M7.5 13.8 Q12 18.4 16.5 13.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
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

interface ClusterOrbProps {
  color: OrbColor;
  label: string;
  onPress: () => void;
  placement: CSSProperties;
}

function ClusterOrb({ color, label, onPress, placement }: ClusterOrbProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    giggle(e.currentTarget);
    onPress();
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      className={cn("glow-orb", `glow-orb-${color}`)}
      style={placement}
    >
      <Smiley />
    </button>
  );
}

export function OrbCluster({
  recording,
  centerRef,
  onPrev,
  onNext,
  onMenu,
  onNextDoc,
  onDelete,
  onRepeat,
}: OrbClusterProps) {
  return (
    <div className="orb-cluster">
      <ClusterOrb
        color="blue"
        label="Previous sentence"
        onPress={onPrev}
        placement={{ gridColumn: 3, gridRow: 1 }}
      />
      <ClusterOrb
        color="red"
        label="Delete sentence"
        onPress={onDelete}
        placement={{ gridColumn: 1, gridRow: 2 }}
      />
      <ClusterOrb
        color="yellow"
        label="Open menu"
        onPress={onMenu}
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
        color="green"
        label="Next document"
        onPress={onNextDoc}
        placement={{ gridColumn: 4, gridRow: 2 }}
      />
      <ClusterOrb
        color="orange"
        label="Repeat sentence"
        onPress={onRepeat}
        placement={{ gridColumn: 5, gridRow: 2 }}
      />
      <ClusterOrb
        color="purple"
        label="Next sentence"
        onPress={onNext}
        placement={{ gridColumn: 3, gridRow: 3 }}
      />
    </div>
  );
}
