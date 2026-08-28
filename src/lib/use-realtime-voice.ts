import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  composeRealtimeInstructions,
  createRealtimeSession,
} from "@/lib/realtime.functions";
import { beginIosRecordingSession, endIosRecordingSession } from "@/lib/audio-session";

export type CallState = "idle" | "connecting" | "live";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/** True for the iOS "category is not compatible with audio capture" family. */
function isSessionCategoryError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = ((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return (
    name === "InvalidStateError" ||
    name === "AbortError" ||
    message.includes("audio session") ||
    message.includes("not compatible") ||
    message.includes("interrupt")
  );
}

/**
 * Open the mic, re-asserting the recording audio session once if iOS rejects
 * the first attempt because playback still owned the category.
 */
async function acquireMic(reassertSession: () => void): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not supported in this browser");
  }
  try {
    return await mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    if (!isSessionCategoryError(error)) throw error;
    reassertSession();
    await new Promise((r) => setTimeout(r, 250));
    return await mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  }
}

type Options = {
  /** Recent conversation text handed to the model as call context. */
  buildContext: () => string;
  /** Documents currently attached to the thread. */
  buildDocumentIds: () => string[];
  /** A finished user turn (speech transcript). */
  onUserText: (text: string) => void;
  /** A finished Orby turn (spoken reply, as text). */
  onAssistantText: (text: string) => void;
  onError?: (message: string) => void;
};

/**
 * Hands-free voice call over the OpenAI Realtime API (WebRTC).
 *
 * The mic streams up, Orby's voice streams down through an <audio> element,
 * and a data channel carries the transcript events we mirror into the chat.
 * Turn-taking + barge-in interruption are handled server-side by semantic VAD,
 * so the user can simply talk over Orby to cut her off.
 */
export function useRealtimeVoice({
  buildContext,
  buildDocumentIds,
  onUserText,
  onAssistantText,
  onError,
}: Options) {
  const mintSession = useServerFn(createRealtimeSession);
  const [state, setState] = useState<CallState>("idle");
  const [speaking, setSpeaking] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const busyRef = useRef(false);
  /** Turn ids already mirrored into the chat — the model repeats "done" events. */
  const seenTurnsRef = useRef<Set<string>>(new Set());
  /** Last thing Orby said, for the speaker-echo guard. */
  const lastAssistantRef = useRef("");
  /** iOS audio-session ownership token held for the whole call. */
  const sessionTokenRef = useRef<number | null>(null);

  const cbRef = useRef({ onUserText, onAssistantText, onError });
  cbRef.current = { onUserText, onAssistantText, onError };

  const stop = useCallback(() => {
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch {
      /* already torn down */
    }
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
    // Only hand the mixable/ambient category back once every mic track is
    // stopped, so speech can mix with music again after the call.
    const sessionToken = sessionTokenRef.current;
    sessionTokenRef.current = null;
    endIosRecordingSession(sessionToken);
    setSpeaking(false);
    setState("idle");
  }, []);


  const start = useCallback(async () => {
    if (busyRef.current || pcRef.current) return;
    busyRef.current = true;
    setState("connecting");
    try {
      const { token, model } = await mintSession({
        data: { context: buildContext(), documentIds: buildDocumentIds() },
      });

      // iOS refuses audio capture while the page sits in the mixable "ambient"
      // category speech playback puts it in ("audio session category is not
      // compatible with audio capture"). Take ownership of a play-and-record
      // session before opening the mic and keep it for the whole call.
      if (sessionTokenRef.current === null) {
        sessionTokenRef.current = beginIosRecordingSession();
      }
      const stream = await acquireMic(() => {
        const previous = sessionTokenRef.current;
        sessionTokenRef.current = beginIosRecordingSession();
        // Drop the superseded token so teardown can restore mixable playback.
        if (previous !== null && previous !== sessionTokenRef.current) {
          endIosRecordingSession(previous);
        }
      });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioRef.current = audio;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        void audio.play().catch(() => {});
      };

      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => {
        let evt: any;
        try {
          evt = JSON.parse(e.data as string);
        } catch {
          return;
        }
        const type: string = evt?.type ?? "";

        // User's finished speech.
        if (type === "conversation.item.input_audio_transcription.completed") {
          const t = (evt.transcript ?? "").trim();
          if (t) cbRef.current.onUserText(t);
          return;
        }
        // Orby's finished spoken reply (event name varies by model version).
        if (
          type === "response.output_audio_transcript.done" ||
          type === "response.audio_transcript.done"
        ) {
          const t = (evt.transcript ?? "").trim();
          if (t) cbRef.current.onAssistantText(t);
          setSpeaking(false);
          return;
        }
        if (type === "response.created") setSpeaking(true);
        if (type === "response.done") setSpeaking(false);
        if (
          type === "input_audio_buffer.speech_started" ||
          type === "response.cancelled"
        ) {
          setSpeaking(false);
        }
        if (type === "error") {
          const msg = evt?.error?.message ?? "Voice call error";
          cbRef.current.onError?.(msg);
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") setState("live");
        if (s === "failed" || s === "closed" || s === "disconnected") {
          if (pcRef.current === pc) {
            cbRef.current.onError?.("Hands-free call ended");
            stop();
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Voice connection failed [${res.status}] ${body.slice(0, 160)}`);
      }
      const answer = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setState("live");
    } catch (err) {
      stop();
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access is needed for hands-free mode"
          : err instanceof Error
            ? err.message
            : "Couldn't start hands-free mode";
      cbRef.current.onError?.(msg);
    } finally {
      busyRef.current = false;
    }
  }, [buildContext, buildDocumentIds, mintSession, stop]);

  /**
   * Push a new attached-document block into the live session so mid-call
   * attach/remove takes effect without dropping the call.
   */
  const updateContext = useCallback(
    (docBlock: string) => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return false;
      try {
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              instructions: composeRealtimeInstructions(buildContext(), docBlock),
            },
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
    [buildContext],
  );

  // Always release the mic when the component goes away.
  useEffect(() => stop, [stop]);

  return {
    state,
    live: state === "live",
    connecting: state === "connecting",
    speaking,
    start,
    stop,
    updateContext,
  };
}
