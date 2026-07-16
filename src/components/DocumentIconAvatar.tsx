import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { proxyMediaUrl } from "@/lib/sb-proxy";

interface Props {
  url: string;
  state?: "idle" | "listening" | "thinking";
  className?: string;
}

/**
 * Circular avatar that replaces the Orb visual on documents with an assigned
 * icon image. Mirrors Orb's outer button so swipes, taps, gestures, and
 * listening/thinking state animations still work identically.
 */
export const DocumentIconAvatar = forwardRef<HTMLButtonElement, Props>(
  function DocumentIconAvatar({ url, state = "idle", className }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Document icon"
        className={cn(
          "orb relative rounded-full select-none touch-none outline-none overflow-hidden",
          "transition-transform active:scale-95",
          state === "listening" && "orb-listening",
          state === "thinking" && "orb-thinking",
          className,
        )}
      >
        <span className="orb-halo" />
        <img
          src={proxyMediaUrl(url)}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover rounded-full pointer-events-none"
        />
      </button>
    );
  },
);
