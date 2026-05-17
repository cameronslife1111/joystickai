import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface OrbProps {
  state?: "idle" | "listening" | "thinking";
  size?: number;
  className?: string;
}

export const Orb = forwardRef<HTMLButtonElement, OrbProps>(function Orb(
  { state = "idle", size = 200, className },
  ref,
) {
  const sizeStyle = size > 0 ? { width: size, height: size } : undefined;
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Joystick orb"
      className={cn(
        "orb relative rounded-full select-none touch-none outline-none",
        "transition-transform active:scale-95",
        state === "listening" && "orb-listening",
        state === "thinking" && "orb-thinking",
        className,
      )}
      style={sizeStyle}
    >
      <span className="orb-halo" />
      <span className="orb-core" />
      <span className="orb-aurora" />
      <span className="orb-highlight" />
    </button>
  );
});
