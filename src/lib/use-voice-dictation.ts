import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";

import { transcribeAudio } from "@/lib/whisper.functions";
import {
  startPcmRecorder,
  blobToBase64,
  releaseMic,
  micErrorMessage,
  type PcmRecorder,
} from "@/lib/audio-recorder";

export type DictationState = "idle" | "recording" | "transcribing";

/**
 * Push-to-dictate helper: first toggle() starts recording, second toggle()
 * stops, transcribes via OpenAI Whisper, and hands the text to `onText`.
 * Callers decide how to merge the text (we always append, never replace).
 */
export function useVoiceDictation(onText: (text: string) => void) {
  const transcribe = useServerFn(transcribeAudio);
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<PcmRecorder | null>(null);
  const busyRef = useRef(false);

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
          const res = await transcribe({ data: { audioBase64, mimeType: blob.type || "audio/wav" } });
          const text = (res?.text ?? "").trim();
          if (!text) toast.error("Nothing was heard — try again");
          else onText(text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setState("idle");
        }
        return;
      }

      try {
        recorderRef.current = await startPcmRecorder();
        setState("recording");
      } catch (err) {
        releaseMic();
        setState("idle");
        const message = micErrorMessage(err);
        if (message) toast.error(message);
      }
    } finally {
      busyRef.current = false;
    }
  }, [onText, transcribe]);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    releaseMic();
    setState("idle");
  }, []);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    toggle,
    cancel,
  };
}

/** Append transcribed text to whatever the field already holds. */
export function appendTranscript(existing: string, text: string) {
  return existing.trim() ? `${existing.trimEnd()} ${text}` : text;
}
