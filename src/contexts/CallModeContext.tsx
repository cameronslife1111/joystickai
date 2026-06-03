import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createRealtimeCallSession } from "@/lib/orby-realtime.functions";
import { webSearchForCall } from "@/lib/orby-call.functions";
import {
  resolveDocumentsByVoice,
  readDocumentsForCall,
  addTextToDocument,
  markSentencesForDeletion,
  editSentence,
  renameDocumentTitle,
} from "@/lib/orby-call-docs.functions";

export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ending"
  | "reading"
  | "adding"
  | "marking";

export type CallMessage = { role: "user" | "assistant"; content: string };

export type ReadingDoc = {
  id: string;
  title: string;
  sentences: { id: string; content: string; order_index: number }[];
};

/**
 * Bridge implemented by the app screen so the call can drive the live view:
 * open documents and jump the sentence cursor. Registered via
 * registerCallController on mount.
 */
export type CallController = {
  getActiveContext: () =>
    | {
        docId: string;
        title: string;
        currentIndex: number;
        sentences: { id: string; content: string }[];
      }
    | null;
  openDocumentById: (id: string) => Promise<{ title: string } | null>;
  jumpToIndex: (index: number) => Promise<void>;
};

interface CallModeContextValue {
  inCall: boolean;
  status: CallStatus;
  messages: CallMessage[];
  partialUser: string;
  micMuted: boolean;
  startCall: () => Promise<void>;
  endCall: (reason?: "user" | "phrase" | "error") => Promise<void>;
  toggleMicMute: () => void;
  overlayMinimized: boolean;
  setOverlayMinimized: (v: boolean) => void;
  readingDocs: ReadingDoc[] | null;
  dismissReadingDocs: () => void;
  actionLabel: string | null;
  registerCallController: (c: CallController | null) => void;
}

const Ctx = createContext<CallModeContextValue | null>(null);

export function useCallMode() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCallMode must be used inside CallModeProvider");
  return v;
}

export function CallModeProvider({ children }: { children: React.ReactNode }) {
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [micMuted, setMicMuted] = useState(false);
  const [overlayMinimized, setOverlayMinimized] = useState(false);
  const [readingDocs, setReadingDocs] = useState<ReadingDoc[] | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const dismissReadingDocs = useCallback(() => setReadingDocs(null), []);

  // Server fns.
  const createSessionFn = useServerFn(createRealtimeCallSession);
  const resolveDocsFn = useServerFn(resolveDocumentsByVoice);
  const readDocsFn = useServerFn(readDocumentsForCall);
  const addTextFn = useServerFn(addTextToDocument);
  const markFn = useServerFn(markSentencesForDeletion);
  const editSentenceFn = useServerFn(editSentence);
  const renameFn = useServerFn(renameDocumentTitle);
  const webSearchFn = useServerFn(webSearchForCall);

  // Refs.
  const inCallRef = useRef(false);
  const controllerRef = useRef<CallController | null>(null);
  const messagesRef = useRef<CallMessage[]>([]);
  const readingDocsRef = useRef<ReadingDoc[] | null>(null);
  const wakeLockRef = useRef<any>(null);
  const endCallRef = useRef<(reason?: "user" | "phrase" | "error") => Promise<void>>(
    async () => {},
  );

  // WebRTC refs.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const speakingRef = useRef(false);
  const assistantBufferRef = useRef("");

  const registerCallController = useCallback((c: CallController | null) => {
    controllerRef.current = c;
  }, []);

  // Keep refs in sync.
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { readingDocsRef.current = readingDocs; }, [readingDocs]);

  // ---- Document resolution helper ----
  const resolveDoc = useCallback(
    async (query: string, purpose: "read" | "add" | "mark", minConf = 0.4) => {
      const recent = messagesRef.current
        .slice(-6)
        .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content)
        .join("\n");
      const { matches } = await resolveDocsFn({
        data: { utterance: query, recentTranscript: recent, expectMultiple: false, purpose },
      });
      return matches.find((m) => m.confidence >= minConf) ?? null;
    },
    [resolveDocsFn],
  );

  // ---- Tool execution: maps Realtime function calls to existing server fns ----
  const executeTool = useCallback(
    async (name: string, args: any): Promise<Record<string, unknown>> => {
      const active = controllerRef.current?.getActiveContext?.() ?? null;
      try {
        switch (name) {
          case "open_document": {
            setStatus("thinking");
            setActionLabel("Finding document…");
            const match = args?.query ? await resolveDoc(args.query, "read") : null;
            setActionLabel(null);
            if (!match) return { ok: false, error: "No matching document found." };
            await controllerRef.current?.openDocumentById(match.id);
            return { ok: true, title: match.title };
          }
          case "find_document": {
            setStatus("thinking");
            setActionLabel("Looking that up…");
            const match = args?.query ? await resolveDoc(args.query, "read", 0.3) : null;
            setActionLabel(null);
            return match ? { ok: true, title: match.title } : { ok: false };
          }
          case "read_document": {
            setStatus("reading");
            setActionLabel("Finding document…");
            let docId: string | null = null;
            let docTitle: string | null = null;
            if (args?.use_active && active) {
              docId = active.docId;
              docTitle = active.title;
            } else if (args?.query) {
              const match = await resolveDoc(args.query, "read");
              if (match) { docId = match.id; docTitle = match.title; }
            } else if (active) {
              docId = active.docId;
              docTitle = active.title;
            }
            if (!docId) { setActionLabel(null); return { ok: false, error: "Which document?" }; }
            setActionLabel(`Reading "${docTitle}"…`);
            const { docs } = await readDocsFn({ data: { documentIds: [docId] } });
            setReadingDocs(docs);
            setActionLabel(null);
            const doc = docs[0];
            return {
              ok: true,
              title: docTitle,
              sentences: doc?.sentences.map((s, i) => ({ index: i, content: s.content })) ?? [],
            };
          }
          case "add_text": {
            if (!args?.text) return { ok: false, error: "Nothing to add." };
            setStatus("adding");
            setActionLabel("Finding document…");
            let docId: string | null = null;
            let docTitle: string | null = null;
            if (args?.use_active && active) { docId = active.docId; docTitle = active.title; }
            else if (args?.query) {
              const match = await resolveDoc(args.query, "add");
              if (match) { docId = match.id; docTitle = match.title; }
            } else if (active) { docId = active.docId; docTitle = active.title; }
            setActionLabel(null);
            if (!docId) return { ok: false, error: "Which document?" };
            const { inserted } = await addTextFn({ data: { documentId: docId, text: args.text } });
            if (active && docId === active.docId) {
              await controllerRef.current?.openDocumentById(docId);
            }
            return { ok: inserted > 0, inserted, title: docTitle };
          }
          case "mark_for_deletion": {
            setStatus("marking");
            let docId: string | null = null;
            let docTitle: string | null = null;
            if (args?.use_active && active) { docId = active.docId; docTitle = active.title; }
            else if (args?.query) {
              const match = await resolveDoc(args.query, "mark");
              if (match) { docId = match.id; docTitle = match.title; }
            } else if (readingDocsRef.current?.[0]) {
              docId = readingDocsRef.current[0].id;
              docTitle = readingDocsRef.current[0].title;
            } else if (active) { docId = active.docId; docTitle = active.title; }
            if (!docId) return { ok: false, error: "Which document?" };
            const { marked } = await markFn({
              data: { documentId: docId, utterance: args?.utterance ?? "" },
            });
            return { ok: marked > 0, marked, title: docTitle };
          }
          case "edit_sentence": {
            if (!active) return { ok: false, error: "No document is open." };
            if (!args?.new_text) return { ok: false, error: "What should it say?" };
            const idx =
              args?.sentence_index != null
                ? Math.max(0, Math.min(args.sentence_index, active.sentences.length - 1))
                : active.currentIndex;
            setStatus("adding");
            const res = await editSentenceFn({
              data: { documentId: active.docId, sentenceIndex: idx, newText: args.new_text },
            });
            await controllerRef.current?.openDocumentById(active.docId);
            return { ok: !!res.updated, sentenceIndex: (res.sentenceIndex ?? idx) + 1 };
          }
          case "jump_to_sentence": {
            if (!active) return { ok: false, error: "No document is open." };
            if (args?.sentence_index == null) return { ok: false, error: "Which sentence?" };
            const total = active.sentences.length;
            const idx = Math.max(0, Math.min(args.sentence_index, Math.max(0, total - 1)));
            await controllerRef.current?.jumpToIndex(idx);
            return { ok: true, sentence: idx + 1 };
          }
          case "rename_document": {
            if (!args?.new_title) return { ok: false, error: "What's the new title?" };
            setStatus("adding");
            setActionLabel("Finding document…");
            let docId: string | null = null;
            if (args?.use_active && active) docId = active.docId;
            else if (args?.query) {
              const match = await resolveDoc(args.query, "read");
              if (match) docId = match.id;
            } else if (active) docId = active.docId;
            setActionLabel(null);
            if (!docId) return { ok: false, error: "Which document?" };
            const res = await renameFn({ data: { documentId: docId, newTitle: args.new_title } });
            if (active && docId === active.docId) {
              await controllerRef.current?.openDocumentById(docId);
            }
            return { ok: true, oldTitle: res.oldTitle, newTitle: res.newTitle };
          }
          case "web_search": {
            if (!args?.query) return { ok: false, error: "What should I search for?" };
            setStatus("thinking");
            setActionLabel("Searching the web…");
            try {
              const res = await webSearchFn({ data: { query: String(args.query) } });
              setActionLabel(null);
              if (!res.ok) return { ok: false, error: res.error };
              return { ok: true, text: res.text };
            } catch {
              setActionLabel(null);
              return { ok: false, error: "The web search failed." };
            }
          }
          case "end_call": {
            // Defer so the model's farewell audio can play first.
            setTimeout(() => { void endCallRef.current("phrase"); }, 1500);
            return { ok: true };
          }
          default:
            return { ok: false, error: "Unknown tool." };
        }
      } catch (e) {
        console.warn("[call] tool error", name, e);
        setActionLabel(null);
        return { ok: false, error: "Something went wrong." };
      }
    },
    [resolveDoc, readDocsFn, addTextFn, markFn, editSentenceFn, renameFn],
  );

  // ---- Send an event over the data channel ----
  const sendEvent = useCallback((evt: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try { dc.send(JSON.stringify(evt)); } catch (e) { console.warn("[call] send failed", e); }
    }
  }, []);

  // ---- Handle a tool call: run it, return output, ask model to continue ----
  const handleToolCall = useCallback(
    async (callId: string, name: string, rawArgs: string) => {
      let args: any = {};
      try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch {}
      const result = await executeTool(name, args);
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        },
      });
      sendEvent({ type: "response.create" });
    },
    [executeTool, sendEvent],
  );

  // ---- Realtime server-event handler ----
  const handleServerEvent = useCallback(
    (evt: any) => {
      const type: string = evt?.type ?? "";

      // User speech lifecycle
      if (type === "input_audio_buffer.speech_started") {
        if (!speakingRef.current) setStatus("listening");
        setPartialUser("…");
        return;
      }
      if (type === "input_audio_buffer.speech_stopped") {
        if (!speakingRef.current) setStatus("thinking");
        return;
      }

      // Live user transcription
      if (type === "conversation.item.input_audio_transcription.delta") {
        if (evt.delta) setPartialUser((p) => (p === "…" ? evt.delta : p + evt.delta));
        return;
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = (evt.transcript ?? "").trim();
        setPartialUser("");
        if (text) setMessages((prev) => [...prev, { role: "user", content: text }]);
        return;
      }

      // Assistant audio output lifecycle (WebRTC-specific)
      if (type === "output_audio_buffer.started") {
        speakingRef.current = true;
        setStatus("speaking");
        setActionLabel(null);
        return;
      }
      if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
        speakingRef.current = false;
        if (inCallRef.current) setStatus("listening");
        return;
      }

      // Assistant transcript (the spoken reply, in text form)
      if (
        type === "response.output_audio_transcript.delta" ||
        type === "response.audio_transcript.delta"
      ) {
        if (evt.delta) assistantBufferRef.current += evt.delta;
        return;
      }
      if (
        type === "response.output_audio_transcript.done" ||
        type === "response.audio_transcript.done"
      ) {
        const text = (evt.transcript ?? assistantBufferRef.current ?? "").trim();
        assistantBufferRef.current = "";
        if (text) setMessages((prev) => [...prev, { role: "assistant", content: text }]);
        return;
      }

      // Tool / function calls
      if (type === "response.function_call_arguments.done") {
        if (evt.call_id && evt.name) {
          void handleToolCall(evt.call_id, evt.name, evt.arguments ?? "{}");
        }
        return;
      }

      if (type === "response.done") {
        if (inCallRef.current && !speakingRef.current) setStatus("listening");
        return;
      }

      if (type === "error") {
        console.warn("[call] realtime error", evt.error ?? evt);
      }
    },
    [handleToolCall],
  );

  // ---- Wake lock (best effort) ----
  const requestWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as any).wakeLock;
      if (wl?.request) wakeLockRef.current = await wl.request("screen");
    } catch {}
  }, []);
  const releaseWakeLock = useCallback(async () => {
    try { await wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
  }, []);

  // ---- Teardown ----
  const teardown = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    dcRef.current = null;
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    const stream = micStreamRef.current;
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    micStreamRef.current = null;
    if (audioElRef.current) {
      try { audioElRef.current.srcObject = null; } catch {}
      try { audioElRef.current.remove(); } catch {}
      audioElRef.current = null;
    }
    speakingRef.current = false;
    assistantBufferRef.current = "";
  }, []);

  // ---- Public: start / end ----
  const startCall = useCallback(async () => {
    if (inCallRef.current) return;

    const hasGUM =
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    const hasRTC = typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined";
    if (!hasGUM || !hasRTC) {
      toast.error("Voice calls aren't supported in this browser. Try Safari on iPhone or Chrome.");
      return;
    }

    setInCall(true);
    setMessages([]);
    setPartialUser("");
    setMicMuted(false);
    setOverlayMinimized(true);
    setStatus("connecting");
    void requestWakeLock();

    // 1) Mic (must come from the user gesture on iOS).
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      toast.error("Microphone access denied");
      teardown();
      setInCall(false);
      setStatus("idle");
      setOverlayMinimized(false);
      return;
    }
    micStreamRef.current = micStream;

    // 2) Mint ephemeral token.
    let token: string;
    try {
      const res = await createSessionFn({ data: {} } as any);
      token = res.token;
    } catch (e) {
      console.warn("[call] session error", e);
      toast.error("Couldn't start the voice session. Please try again.");
      teardown();
      setInCall(false);
      setStatus("idle");
      setOverlayMinimized(false);
      return;
    }

    // 3) WebRTC peer connection.
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        if (audioElRef.current) {
          audioElRef.current.srcObject = e.streams[0];
          void audioElRef.current.play().catch(() => {});
        }
      };

      micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", (e) => {
        try { handleServerEvent(JSON.parse(e.data)); } catch {}
      });
      dc.addEventListener("open", () => {
        if (inCallRef.current) setStatus("listening");
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls?model=gpt-realtime", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        const t = await sdpRes.text();
        throw new Error(`SDP exchange failed (${sdpRes.status}): ${t}`);
      }
      const answer = { type: "answer" as const, sdp: await sdpRes.text() };
      await pc.setRemoteDescription(answer);
    } catch (e) {
      console.warn("[call] webrtc setup failed", e);
      toast.error("Couldn't connect the call. Please try again.");
      teardown();
      setInCall(false);
      setStatus("idle");
      setOverlayMinimized(false);
      void releaseWakeLock();
      return;
    }
  }, [createSessionFn, handleServerEvent, requestWakeLock, releaseWakeLock, teardown]);

  const endCall = useCallback(
    async (_reason?: "user" | "phrase" | "error") => {
      if (!inCallRef.current) return;
      setStatus("ending");
      teardown();
      await releaseWakeLock();
      setInCall(false);
      setStatus("idle");
      setPartialUser("");
      setReadingDocs(null);
      setActionLabel(null);
      setOverlayMinimized(false);
    },
    [releaseWakeLock, teardown],
  );
  useEffect(() => { endCallRef.current = endCall; }, [endCall]);

  const toggleMicMute = useCallback(() => {
    setMicMuted((m) => {
      const next = !m;
      const stream = micStreamRef.current;
      if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      teardown();
      void releaseWakeLock();
    };
  }, [releaseWakeLock, teardown]);

  const value = useMemo<CallModeContextValue>(
    () => ({
      inCall,
      status,
      messages,
      partialUser,
      micMuted,
      startCall,
      endCall,
      toggleMicMute,
      overlayMinimized,
      setOverlayMinimized,
      readingDocs,
      dismissReadingDocs,
      actionLabel,
      registerCallController,
    }),
    [
      inCall,
      status,
      messages,
      partialUser,
      micMuted,
      startCall,
      endCall,
      toggleMicMute,
      overlayMinimized,
      readingDocs,
      dismissReadingDocs,
      actionLabel,
      registerCallController,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
