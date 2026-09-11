import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { createLiveSession } from "@/lib/live.functions";
import { beginIosRecordingSession, endIosRecordingSession } from "@/lib/audio-session";

export type CallState = "idle" | "connecting" | "live";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/** Transcript fragments are committed once a stream has been quiet this long. */
const COMMIT_SILENCE_MS = 1_100;
/** A call with no speech at all for this long hangs itself up (it bills per minute). */
const IDLE_CUTOFF_MS = 8 * 60_000;
/** Live caps a single context append at 500 tokens. */
const MAX_APPEND_CHARS = 1_200;

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

/** Wait for ICE gathering so the offer we send is complete. */
async function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", done);
    // Never block the call on a slow STUN server.
    setTimeout(resolve, 1_500);
  });
}

function normalizeSpeech(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a "user" transcript is really the speaker feeding Orby's own voice
 * back into the mic — the cause of Orby replying to herself.
 */
function isSelfEcho(userText: string, assistantText: string): boolean {
  const u = normalizeSpeech(userText);
  const a = normalizeSpeech(assistantText);
  if (!u || !a || u.length < 6) return false;
  if (a.includes(u)) return true;
  const words = u.split(" ");
  const hits = words.filter((w) => w.length > 2 && a.includes(w)).length;
  return words.length >= 4 && hits / words.length >= 0.9;
}

type Options = {
  /** Recent conversation text handed to the model as call context. */
  buildContext: () => string;
  /** Documents currently attached to the thread. */
  buildDocumentIds: () => string[];
  /** Thread the call belongs to, so the server can build full context. */
  buildThreadId: () => string | null;
  /** A finished user turn (speech transcript). */
  onUserText: (text: string) => void;
  /** A finished Orby turn (spoken reply, as text). */
  onAssistantText: (text: string) => void;
  /** GPT-Live wants backend work done — Orby's own stack takes it from here. */
  onDelegation?: (delegationId: string) => void;
  onError?: (message: string) => void;
};

/**
 * Hands-free voice call on GPT-Live-1 over WebRTC.
 *
 * GPT-Live only runs the conversation: it is full duplex (it listens while it
 * speaks, so the user can talk over it), and any real work is handed back to
 * this app through client delegation. The project API key never reaches the
 * browser — our server does the SDP exchange.
 */
export function useLiveVoice({
  buildContext,
  buildDocumentIds,
  buildThreadId,
  onUserText,
  onAssistantText,
  onDelegation,
  onError,
}: Options) {
  const mintSession = useServerFn(createLiveSession);
  const [state, setState] = useState<CallState>("idle");
  const [speaking, setSpeaking] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const startedRef = useRef(false);
  /** Commands issued before `session.started` arrive are flushed after it. */
  const queuedRef = useRef<unknown[]>([]);
  const busyRef = useRef(false);
  /** Last thing Orby said, for the speaker-echo guard. */
  const lastAssistantRef = useRef("");
  /** iOS audio-session ownership token held for the whole call. */
  const sessionTokenRef = useRef<number | null>(null);
  /** Buffered transcript fragments; Live sends deltas with no "done" event. */
  const bufRef = useRef({ user: "", assistant: "" });
  const timersRef = useRef<{ user: number | null; assistant: number | null }>({
    user: null,
    assistant: null,
  });
  const lastActivityRef = useRef(Date.now());
  const idleTimerRef = useRef<number | null>(null);

  const cbRef = useRef({ onUserText, onAssistantText, onDelegation, onError });
  cbRef.current = { onUserText, onAssistantText, onDelegation, onError };

  const clearTranscriptTimers = () => {
    for (const key of ["user", "assistant"] as const) {
      const t = timersRef.current[key];
      if (t !== null) window.clearTimeout(t);
      timersRef.current[key] = null;
    }
  };

  const stop = useCallback(() => {
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch {
      /* already torn down */
    }
    pcRef.current = null;
    dcRef.current = null;
    startedRef.current = false;
    queuedRef.current = [];
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
    clearTranscriptTimers();
    if (idleTimerRef.current !== null) window.clearInterval(idleTimerRef.current);
    idleTimerRef.current = null;
    bufRef.current = { user: "", assistant: "" };
    lastAssistantRef.current = "";
    setSpeaking(false);
    setState("idle");
  }, []);

  /** Send a data-channel command, queueing it until `session.started`. */
  const send = useCallback((event: Record<string, unknown>): boolean => {
    const dc = dcRef.current;
    if (!dc) return false;
    if (!startedRef.current || dc.readyState !== "open") {
      queuedRef.current.push(event);
      return true;
    }
    try {
      dc.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current || pcRef.current) return;
    busyRef.current = true;
    setState("connecting");
    try {
      // iOS refuses audio capture while the page sits in the mixable "ambient"
      // category speech playback puts it in. Take ownership of a play-and-record
      // session before opening the mic and keep it for the whole call.
      if (sessionTokenRef.current === null) {
        sessionTokenRef.current = beginIosRecordingSession();
      }
      const stream = await acquireMic(() => {
        const previous = sessionTokenRef.current;
        sessionTokenRef.current = beginIosRecordingSession();
        if (previous !== null && previous !== sessionTokenRef.current) {
          endIosRecordingSession(previous);
        }
      });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      // Inline playback keeps iOS from handing the stream to the fullscreen
      // player (which bypasses echo cancellation and makes Orby hear herself).
      audio.setAttribute("playsinline", "");
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audio.volume = 1;
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioRef.current = audio;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        void audio.play().catch(() => {});
      };

      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      /** Commit a buffered transcript into the chat as one finished turn. */
      const commit = (who: "user" | "assistant") => {
        const text = bufRef.current[who].trim();
        bufRef.current[who] = "";
        timersRef.current[who] = null;
        if (!text) return;
        if (who === "assistant") {
          lastAssistantRef.current = text;
          cbRef.current.onAssistantText(text);
          setSpeaking(false);
          return;
        }
        // Speaker bleed: this is Orby's own sentence coming back through the
        // mic. Mirroring it would make her answer herself.
        if (isSelfEcho(text, lastAssistantRef.current)) return;
        cbRef.current.onUserText(text);
      };

      const bump = (who: "user" | "assistant", delta: string) => {
        lastActivityRef.current = Date.now();
        bufRef.current[who] += delta;
        const existing = timersRef.current[who];
        if (existing !== null) window.clearTimeout(existing);
        timersRef.current[who] = window.setTimeout(() => commit(who), COMMIT_SILENCE_MS);
      };

      // The event channel must exist before the offer is created.
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

        if (type === "session.started") {
          startedRef.current = true;
          setState("live");
          const queued = queuedRef.current;
          queuedRef.current = [];
          for (const q of queued) {
            try {
              dc.send(JSON.stringify(q));
            } catch {
              /* dropped: the next append retries */
            }
          }
          return;
        }
        if (type === "session.input_transcript.delta") {
          bump("user", String(evt.delta ?? ""));
          return;
        }
        if (type === "session.output_transcript.delta") {
          setSpeaking(true);
          bump("assistant", String(evt.delta ?? ""));
          return;
        }
        if (type === "session.delegation.created") {
          // Flush whatever the user just said so the backend turn sees it.
          const pending = timersRef.current.user;
          if (pending !== null) {
            window.clearTimeout(pending);
            commit("user");
          }
          const id = evt?.delegation?.id ?? null;
          if (typeof id === "string") cbRef.current.onDelegation?.(id);
          return;
        }
        if (type === "session.closed") {
          if (pcRef.current === pc) {
            const reason = evt?.reason ?? "";
            if (reason && reason !== "close_requested") {
              cbRef.current.onError?.("Hands-free call ended");
            }
            stop();
          }
          return;
        }
        if (type === "error") {
          const msg = evt?.error?.message ?? "Voice call error";
          cbRef.current.onError?.(msg);
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected" && startedRef.current) setState("live");
        if (s === "failed" || s === "closed" || s === "disconnected") {
          if (pcRef.current === pc) {
            cbRef.current.onError?.("Hands-free call ended");
            stop();
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);

      const { sdp } = await mintSession({
        data: {
          sdp: pc.localDescription?.sdp ?? offer.sdp ?? "",
          context: buildContext(),
          documentIds: buildDocumentIds(),
          threadId: buildThreadId(),
        },
      });
      await pc.setRemoteDescription({ type: "answer", sdp });

      // A forgotten call bills by the minute — hang up after long silence.
      lastActivityRef.current = Date.now();
      idleTimerRef.current = window.setInterval(() => {
        if (Date.now() - lastActivityRef.current > IDLE_CUTOFF_MS) {
          cbRef.current.onError?.("Hands-free ended after a long silence");
          stop();
        }
      }, 30_000);
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
  }, [buildContext, buildDocumentIds, buildThreadId, mintSession, stop]);

  /** Silent context the model can use but must not read out. */
  const appendThinking = useCallback(
    (content: string, delegationId: string | null = null) =>
      send({
        type: "session.thinking.append",
        delegation_id: delegationId,
        content: content.slice(0, MAX_APPEND_CHARS),
      }),
    [send],
  );

  /** Content Orby should say out loud, in her own words. */
  const appendCommentary = useCallback(
    (content: string, delegationId: string | null = null) =>
      send({
        type: "session.commentary.append",
        delegation_id: delegationId,
        content: content.slice(0, MAX_APPEND_CHARS),
      }),
    [send],
  );

  /** Steering rules — used when the thread's attached documents change. */
  const appendInstructions = useCallback(
    (content: string, delegationId: string | null = null) =>
      send({
        type: "session.instructions.append",
        delegation_id: delegationId,
        content: content.slice(0, MAX_APPEND_CHARS),
      }),
    [send],
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
    appendThinking,
    appendCommentary,
    appendInstructions,
  };
}
