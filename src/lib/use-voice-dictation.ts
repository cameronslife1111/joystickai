import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { transcribeAudio } from "@/lib/whisper.functions";
import { startPcmRecorder, blobToBase64, releaseMic, type PcmRecorder } from "@/lib/audio-recorder";

export type DictationState = "idle" | "recording" | "transcribing";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isNetworkError = (err: unknown) => {
  const m = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    m.includes("load failed") ||
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("aborted") ||
    m.includes("timeout")
  );
};

/**
 * Push-to-dictate helper: first toggle() starts recording, second toggle()
 * stops, transcribes via OpenAI GPT-Transcribe, and hands the text to `onText`.
 * Callers decide how to merge the text (we always append, never replace).
 *
 * A recorded clip is kept in memory until it transcribes successfully, so a
 * dropped upload ("Load failed" on flaky 5G) never loses the recording: it
 * auto-retries, then offers a one-tap manual retry.
 */
export function useVoiceDictation(onText: (text: string) => void) {
  const transcribe = useServerFn(transcribeAudio);
  const [state, setState] = useState<DictationState>("idle");
  const [pending, setPending] = useState(false);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const busyRef = useRef(false);
  // The last recording that has not yet produced a transcript.
  const pendingRef = useRef<{ audioBase64: string; mimeType: string } | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  /** Send the held clip, retrying transient network failures. */
  const send = useCallback(async () => {
    const clip = pendingRef.current;
    if (!clip) return;
    setState("transcribing");
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await transcribe({ data: clip });
        const text = (res?.text ?? "").trim();
        pendingRef.current = null;
        setPending(false);
        setState("idle");
        if (!text) toast.error("Nothing was heard — try again");
        else onTextRef.current(text);
        return;
      } catch (err) {
        lastErr = err;
        if (!isNetworkError(err)) break;
        await sleep(600 * (attempt + 1));
      }
    }

    setState("idle");
    setPending(true);
    const network = isNetworkError(lastErr);
    toast.error(
      network
        ? "Couldn't reach the server — your recording is saved"
        : lastErr instanceof Error
          ? lastErr.message
          : "Transcription failed",
      {
        duration: 30000,
        action: { label: "Retry", onClick: () => void send() },
      },
    );
  }, [transcribe]);

  const toggle = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (recorderRef.current) {
        const rec = recorderRef.current;
        recorderRef.current = null;
        setState("transcribing");
        let blob: Blob;
        try {
          blob = await rec.stop();
        } catch {
          releaseMic();
          setState("idle");
          toast.error("Recording failed");
          return;
        }
        // Fully release the mic so iOS drops the recording indicator.
        releaseMic();
        // Header-only WAV = silent mic / instant stop.
        if (blob.size < 4096) {
          setState("idle");
          toast.error("That recording was too short — try again");
          return;
        }
        try {
          const audioBase64 = await blobToBase64(blob);
          pendingRef.current = { audioBase64, mimeType: "audio/wav" };
          setPending(true);
        } catch {
          setState("idle");
          toast.error("Couldn't prepare the recording — try again");
          return;
        }
        await send();
        return;
      }

      try {
        recorderRef.current = await startPcmRecorder();
        setState("recording");
      } catch {
        releaseMic();
        setState("idle");
        toast.error("Microphone access is needed to record");
      }
    } finally {
      busyRef.current = false;
    }
  }, [send]);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    releaseMic();
    setState("idle");
  }, []);

  const discard = useCallback(() => {
    pendingRef.current = null;
    setPending(false);
  }, []);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    /** True when a recording is held because transcription hasn't succeeded. */
    pending,
    /** Re-send the held recording. */
    retry: send,
    discard,
    toggle,
    cancel,
  };
}

/** Append transcribed text to whatever the field already holds. */
export function appendTranscript(existing: string, text: string) {
  return existing.trim() ? `${existing.trimEnd()} ${text}` : text;
}
