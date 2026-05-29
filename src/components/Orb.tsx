import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
import { useOrbMood } from "@/hooks/use-orb-mood";

interface OrbProps {
  state?: "idle" | "listening" | "thinking";
  size?: number;
  className?: string;
  /** When false, mood stays at 1 and never decays (e.g. landing page). */
  interactive?: boolean;
}

export type OrbHandle = HTMLButtonElement & {
  boostMood: (amount?: number) => void;
};

export const Orb = forwardRef<HTMLButtonElement, OrbProps>(function Orb(
  { state = "idle", size = 200, className, interactive = true },
  ref,
) {
  const innerRef = useRef<HTMLButtonElement | null>(null);
  const { mood, boost, blinking, gaze, talking, mouthOpen } = useOrbMood({ interactive });

  // Expose boostMood on the DOM node so callers using a plain HTMLButtonElement
  // ref (e.g. app.tsx) can trigger it without a separate API.
  useImperativeHandle(
    ref,
    () => {
      const el = innerRef.current as OrbHandle;
      if (el) el.boostMood = boost;
      return el!;
    },
    [boost],
  );

  // Keep boostMood fresh on the DOM node when boost identity changes.
  useEffect(() => {
    const el = innerRef.current as OrbHandle | null;
    if (el) el.boostMood = boost;
  }, [boost]);

  const sizeStyle = size > 0 ? { width: size, height: size } : undefined;

  // Mood-driven values
  const asleep = mood <= 0.02;
  // Saturation: 0 → fully gray, 1 → vivid
  const saturation = mood;
  // Hue shift: at low mood, shift toward red/brown (negative degrees from violet)
  const hueShift = (mood - 1) * 60; // 0 at happy, -60deg at sad
  // Brightness dips slightly when sad
  const brightness = 0.7 + 0.3 * mood;

  // Mouth path interpolation
  // viewBox 100x100, centered at 50,60
  // Sad (mood 0): frown — curve dips down at center
  // Neutral (0.5): flat
  // Happy (1): smile — curve rises at center
  // We interpolate the control point Y.
  // Mouth width grows with mood a bit too.
  const mouthWidth = 14 + mood * 10; // 14 → 24
  const mouthY = 62;
  const curveOffset = (mood - 0.5) * 16; // negative = frown, positive = smile
  const mx1 = 50 - mouthWidth / 2;
  const mx2 = 50 + mouthWidth / 2;
  const mcy = mouthY + curveOffset;
  const mouthD = asleep
    ? `M ${50 - 6} ${mouthY} Q 50 ${mouthY + 1} ${50 + 6} ${mouthY}`
    : `M ${mx1} ${mouthY} Q 50 ${mcy} ${mx2} ${mouthY}`;

  // Eye geometry
  const eyeRX = 2.6;
  // Bigger eyes when happy, droopy small when sad; closed when asleep
  const eyeRYOpen = 2.4 + mood * 1.6;
  const eyeRY = asleep ? 0.4 : blinking ? 0.4 : eyeRYOpen;
  const eyeY = 44;
  const leftEyeX = 40;
  const rightEyeX = 60;
  // Gaze offsets
  const gx = asleep ? 0 : gaze.x * 0.9;
  const gy = asleep ? 0 : gaze.y * 0.7;

  return (
    <button
      ref={(node) => {
        innerRef.current = node;
        if (node) (node as OrbHandle).boostMood = boost;
      }}
      type="button"
      aria-label="Orby"
      // Prevent the orb <button> from grabbing focus on tap. On iOS, if the
      // button steals focus right after pointer-up, it pulls focus away from
      // the primed hidden input and the on-screen keyboard collapses before
      // the edit / new-idea textarea can inherit it. Suppressing the default
      // focus on pointerdown/mousedown keeps focus on the text inputs so the
      // keyboard stays open. Click/gesture behavior is unaffected.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "orb relative rounded-full select-none touch-none outline-none",
        "transition-transform active:scale-95",
        state === "listening" && "orb-listening",
        state === "thinking" && "orb-thinking",
        asleep && "orb-asleep",
        className,
      )}
      style={{
        ...sizeStyle,
        // CSS vars consumed by .orb-core / .orb-aurora filters
        ["--orb-saturation" as any]: saturation.toFixed(3),
        ["--orb-hue-shift" as any]: `${hueShift.toFixed(1)}deg`,
        ["--orb-brightness" as any]: brightness.toFixed(3),
      }}
    >
      <span className="orb-halo" />
      <span className="orb-core" />
      <span className="orb-aurora" />
      <span className="orb-highlight" />
      <svg
        className="orb-face"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <g
          style={{
            transition: "transform 600ms ease-out",
            transform: `translate(${gx}px, ${gy}px)`,
          }}
        >
          <ellipse
            cx={leftEyeX}
            cy={eyeY}
            rx={eyeRX}
            ry={eyeRY}
            style={{ transition: "ry 160ms ease, cy 160ms ease" }}
          />
          <ellipse
            cx={rightEyeX}
            cy={eyeY}
            rx={eyeRX}
            ry={eyeRY}
            style={{ transition: "ry 160ms ease, cy 160ms ease" }}
          />
        </g>
        <path
          d={mouthD}
          fill="none"
          strokeWidth={2.2}
          strokeLinecap="round"
          style={{ transition: "d 500ms ease" }}
        />
        {!asleep && (
          <ellipse
            cx={50}
            cy={mouthY + curveOffset * 0.4}
            rx={Math.max(3, mouthWidth * 0.35)}
            ry={talking ? 0.6 + mouthOpen * 5.2 : 0}
            style={{
              transition: "ry 80ms ease-out",
              opacity: talking ? 1 : 0,
            }}
          />
        )}
      </svg>
    </button>
  );
});
