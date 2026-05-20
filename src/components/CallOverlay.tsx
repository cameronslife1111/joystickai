import { useCallMode } from "@/contexts/CallModeContext";
import { Orb } from "@/components/Orb";
import { Mic, MicOff, PhoneOff, ChevronDown, FileText } from "lucide-react";

export function CallOverlay() {
  const {
    inCall,
    status,
    messages,
    partialUser,
    micMuted,
    endCall,
    toggleMicMute,
    overlayMinimized,
    setOverlayMinimized,
    generatePlanFromConversation,
  } = useCallMode();

  if (!inCall || overlayMinimized) return null;

  const statusLabel =
    status === "speaking"
      ? "Orby is speaking…"
      : status === "thinking"
        ? "Thinking…"
        : status === "ending"
          ? "Hanging up…"
          : micMuted
            ? "Mic muted"
            : "Listening…";

  const lastAssistant =
    [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-xl"
      style={{ height: "100svh" }}
      role="dialog"
      aria-label="Call with Orby"
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 pt-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => setOverlayMinimized(true)}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
          aria-label="Minimize call"
        >
          <ChevronDown className="h-4 w-4" />
          Minimize
        </button>
        <div className="text-xs text-muted-foreground">On a call with Orby</div>
        <div className="w-[88px]" />
      </div>

      {/* Centered orb + caption */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="relative h-[220px] w-[220px]">
          <Orb size={0} className="orb-call !w-full !h-full" state="idle" />
        </div>

        <div className="mt-8 max-w-md text-base text-muted-foreground" role="status">
          {statusLabel}
        </div>

        {/* Live caption strip */}
        <div className="mt-6 min-h-[3.5rem] max-w-md text-lg leading-snug text-foreground">
          {partialUser ? (
            <span className="text-foreground/90">{partialUser}</span>
          ) : status === "speaking" && lastAssistant ? (
            <span className="text-foreground/70 italic">"{lastAssistant}"</span>
          ) : (
            <span className="text-muted-foreground/60">
              Start talking — Orby will reply when you pause.
            </span>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className="flex items-center justify-center gap-4 px-6 pb-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={toggleMicMute}
          className={`flex h-14 w-14 items-center justify-center rounded-full border border-border transition active:scale-95 ${
            micMuted ? "bg-muted text-muted-foreground" : "bg-card text-foreground"
          }`}
          aria-label={micMuted ? "Unmute mic" : "Mute mic"}
        >
          {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={async () => {
            await generatePlanFromConversation();
            await endCall("plan");
          }}
          disabled={messages.length < 2}
          className="flex h-14 items-center gap-2 rounded-full bg-yellow-400 px-5 text-sm font-semibold text-black shadow-md transition active:scale-95 disabled:opacity-40"
          aria-label="Generate plan from call"
        >
          <FileText className="h-5 w-5" />
          Make plan
        </button>

        <button
          type="button"
          onClick={() => void endCall("user")}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition active:scale-95"
          aria-label="End call"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
