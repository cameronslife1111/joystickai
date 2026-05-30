import { useCallMode } from "@/contexts/CallModeContext";
import { Orb } from "@/components/Orb";
import { Mic, MicOff, PhoneOff, ChevronDown, FileText, X } from "lucide-react";
import { useState, useEffect } from "react";

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
    readingDocs,
    dismissReadingDocs,
    actionLabel,
  } = useCallMode();

  const [activeDocIdx, setActiveDocIdx] = useState(0);
  useEffect(() => {
    if (!readingDocs || readingDocs.length === 0) setActiveDocIdx(0);
    else if (activeDocIdx >= readingDocs.length) setActiveDocIdx(0);
  }, [readingDocs, activeDocIdx]);

  if (!inCall || overlayMinimized) return null;

  const statusLabel =
    actionLabel ??
    (status === "speaking"
      ? "Orby is speaking…"
      : status === "thinking"
        ? "Thinking…"
        : status === "reading"
          ? "Reading…"
          : status === "adding"
            ? "Adding…"
            : status === "marking"
              ? "Marking sentences…"
              : status === "ending"
                ? "Hanging up…"
                : micMuted
                  ? "Mic muted"
                  : "Listening…");

  const lastAssistant =
    [...messages]
      .reverse()
      .find(
        (m) => m.role === "assistant" && !m.content.startsWith('[document: "'),
      )?.content ?? "";

  const activeDoc = readingDocs?.[activeDocIdx];

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

      {/* Centered orb + caption OR reading panel */}
      <div className="flex flex-1 flex-col items-center justify-start overflow-hidden px-6 pt-6 text-center">
        {readingDocs && readingDocs.length > 0 ? (
          <div className="flex w-full max-w-2xl flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {readingDocs.map((d, i) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDocIdx(i)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      i === activeDocIdx
                        ? "bg-foreground text-background"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <FileText className="mr-1 inline h-3 w-3" />
                    {d.title}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={dismissReadingDocs}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted/40"
                aria-label="Close document"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 text-left font-display text-base leading-relaxed">
              {activeDoc?.sentences.length ? (
                activeDoc.sentences.map((s, i) => (
                  <p key={s.id} className="mb-2">
                    <span className="mr-2 text-xs text-muted-foreground">
                      {i + 1}.
                    </span>
                    {s.content}
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground italic">This document is empty.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="relative h-[220px] w-[220px]">
              <Orb size={0} className="orb-call !w-full !h-full" state="idle" />
            </div>
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
        )}

        <div className="mt-4 max-w-md text-sm text-muted-foreground" role="status">
          {statusLabel}
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
