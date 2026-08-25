import type { CSSProperties, MouseEvent, RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, FileText, Menu, Trash2, Volume2 } from "lucide-react";
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
  /** Full literal class (e.g. "glow-orb-blue") so Tailwind's scanner sees it. */
  orbClass: string;
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  placement: CSSProperties;
}

function ClusterOrb({ orbClass, Icon, label, onPress, placement }: ClusterOrbProps) {
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
        orbClass="glow-orb-blue"
        Icon={ArrowUp}
        label="Previous sentence"
        onPress={onPrev}
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
        placement={{ gridColumn: 4, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-orange"
        Icon={Volume2}
        label="Repeat sentence"
        onPress={onRepeat}
        placement={{ gridColumn: 5, gridRow: 2 }}
      />
      <ClusterOrb
        orbClass="glow-orb-purple"
        Icon={ArrowDown}
        label="Next sentence"
        onPress={onNext}
        placement={{ gridColumn: 3, gridRow: 3 }}
      />
    </div>
  );
}
