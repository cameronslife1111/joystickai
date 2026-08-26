import { useEffect, useRef, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, FileText, Menu, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Decorative version of the app's small action-icon orbs for the public landing
 * page. Non-interactive: pointer events pass through. Supports a slow idle
 * float and an optional scroll parallax drift.
 */

export type OrbColor = "blue" | "purple" | "yellow" | "green" | "red" | "orange";

/** Literal class names so Tailwind's scanner always keeps the utilities. */
const COLOR_CLASS: Record<OrbColor, string> = {
  blue: "glow-orb-blue",
  purple: "glow-orb-purple",
  yellow: "glow-orb-yellow",
  green: "glow-orb-green",
  red: "glow-orb-red",
  orange: "glow-orb-orange",
};

const COLOR_ICON: Record<OrbColor, LucideIcon> = {
  blue: ArrowUp,
  purple: ArrowDown,
  yellow: Menu,
  green: FileText,
  red: Trash2,
  orange: Pin,
};

/** Approximate hex per orb color, for dots/glows outside the orb itself. */
export const ORB_HEX: Record<OrbColor, string> = {
  blue: "#60a5fa",
  purple: "#a78bfa",
  yellow: "#facc15",
  green: "#4ade80",
  red: "#f87171",
  orange: "#fb923c",
};

interface LandingOrbProps {
  color: OrbColor;
  /** Pixel size, or "fill" to size itself to the parent (e.g. a grid cell). */
  size?: number | "fill";
  className?: string;
  style?: CSSProperties;
  /** Parallax drift: fraction of scrollY applied as vertical translate. */
  drift?: number;
  /** Delay for the idle float animation, e.g. "0.8s". */
  floatDelay?: string;
  /** Highlight state (used by the "meet the orbs" sequence). */
  active?: boolean;
}

export function LandingOrb({
  color,
  size = 44,
  className,
  style,
  drift = 0,
  floatDelay = "0s",
  active = false,
}: LandingOrbProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const Icon = COLOR_ICON[color];

  useEffect(() => {
    if (!drift) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = wrapRef.current;
      if (el) el.style.transform = `translate3d(0, ${(window.scrollY * drift).toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [drift]);

  // "fill" leaves sizing to CSS (`.landing-cluster .landing-orb`) so the orb
  // stays square even inside a non-square grid cell.
  const sizeStyle: CSSProperties = size === "fill" ? {} : { width: size, height: size };

  return (
    <div ref={wrapRef} aria-hidden className={cn("pointer-events-none", className)} style={style}>
      <div
        className={cn(
          "landing-float h-full w-full",
          size === "fill" && "flex items-center justify-center",
        )}
        style={{ animationDelay: floatDelay }}
      >
        <div
          className={cn("glow-orb landing-orb", COLOR_CLASS[color], active && "landing-orb-active")}
          style={sizeStyle}
        >
          <Icon className="glow-orb-icon" aria-hidden="true" focusable="false" strokeWidth={2.6} />
        </div>
      </div>
    </div>
  );
}
