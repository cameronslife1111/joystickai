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
import { chatWithOrby } from "@/lib/orby-call.functions";
import { transcribeAudio } from "@/lib/orby-stt.functions";
import { interpretCommand } from "@/lib/orby-call-intent.functions";
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

// Pick a pleasant English voice if available.
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const prefer =
    en.find((v) => /samantha|google us english|aria|jenny|natural/i.test(v.name)) ||
    en.find((v) => v.default) ||
    en[0] ||
    voices[0];
  return prefer ?? null;
}

function pickMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {}
  }
  return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// VAD tuning.
const VAD_THRESHOLD = 0.02; // RMS over which we consider the user speaking
const SILENCE_MS = 750; // quiet time after speech that ends a segment
const MAX_SEGMENT_MS = 15000; // hard cap on a single utterance

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
  const callChat = useServerFn(chatWithOrby);
  const transcribeFn = useServerFn(transcribeAudio);
  const interpretFn = useServerFn(interpretCommand);
  const resolveDocsFn = useServerFn(resolveDocumentsByVoice);
  const readDocsFn = useServerFn(readDocumentsForCall);
  const addTextFn = useServerFn(addTextToDocument);
  const markFn = useServerFn(markSentencesForDeletion);
  const editSentenceFn = useServerFn(editSentence);
  const renameFn = useServerFn(renameDocumentTitle);

  // Refs.
  const inCallRef = useRef(false);
  const micMutedRef = useRef(false);
  const statusRef = useRef<CallStatus>("idle");
  const sendingRef = useRef(false);
  const wakeLockRef = useRef<any>(null);
  const controllerRef = useRef<CallController | null>(null);
  const messagesRef = useRef<CallMessage[]>([]);
  const readingDocsRef = useRef<ReadingDoc[] | null>(null);
  const endCallRef = useRef<(reason?: "user" | "phrase" | "error") => Promise<void>>(
    async () => {},
  );

  // Audio capture refs.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");
  const rafRef = useRef<number | null>(null);
  const voiceDetectedRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const segmentStartRef = useRef(0);

  const registerCallController = useCallback((c: CallController | null) => {
    controllerRef.current = c;
  }, []);

  // Keep refs in sync.
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { readingDocsRef.current = readingDocs; }, [readingDocs]);

  // ---- TTS (output stays on-device) ----
  const speakAsync = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice();
        if (v) u.voice = v;
        u.rate = 1.05;
        u.pitch = 1;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      } catch {
        resolve();
      }
    });
  }, []);

  // ---- Recording / VAD ----
  const stopRecorder = useCallback((discard: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return;
    try {
      if (discard) rec.ondataavailable = null;
      rec.onstop = discard ? null : rec.onstop;
      if (rec.state !== "inactive") rec.stop();
    } catch {}
  }, []);

  // Forward declaration via ref to avoid TDZ in callbacks.
  const processSegmentRef = useRef<(blob: Blob) => Promise<void>>(async () => {});

  const armRecorder = useCallback(() => {
    if (!inCallRef.current) return;
    if (micMutedRef.current) return;
    if (statusRef.current !== "listening") return;
    if (recorderRef.current) return;
    const stream = streamRef.current;
    if (!stream) return;

    try {
      const rec = new MediaRecorder(stream, { mimeType: mimeTypeRef.current });
      chunksRef.current = [];
      voiceDetectedRef.current = false;
      lastVoiceAtRef.current = 0;
      segmentStartRef.current = Date.now();
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const hadVoice = voiceDetectedRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        chunksRef.current = [];
        if (!hadVoice || blob.size < 1200) {
          // Just noise — re-arm and keep listening.
          if (inCallRef.current && statusRef.current === "listening") {
            armRecorder();
          }
          return;
        }
        void processSegmentRef.current(blob);
      };
      recorderRef.current = rec;
      rec.start();
    } catch (e) {
      console.warn("[call] arm recorder failed", e);
      recorderRef.current = null;
    }
  }, []);

  const vadTick = useCallback(() => {
    if (!inCallRef.current) return;
    const analyser = analyserRef.current;
    if (analyser && statusRef.current === "listening" && recorderRef.current && !micMutedRef.current) {
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > VAD_THRESHOLD) {
        voiceDetectedRef.current = true;
        lastVoiceAtRef.current = now;
        if (!partialUserRef.current) setPartialUser("…");
      } else if (
        voiceDetectedRef.current &&
        lastVoiceAtRef.current &&
        now - lastVoiceAtRef.current > SILENCE_MS
      ) {
        // End of utterance.
        stopRecorder(false);
      }
      // Hard cap.
      if (
        voiceDetectedRef.current &&
        segmentStartRef.current &&
        now - segmentStartRef.current > MAX_SEGMENT_MS
      ) {
        stopRecorder(false);
      }
    }
    rafRef.current = requestAnimationFrame(vadTick);
  }, [stopRecorder]);

  const partialUserRef = useRef("");
  useEffect(() => { partialUserRef.current = partialUser; }, [partialUser]);

  const backToListening = useCallback(() => {
    if (!inCallRef.current) return;
    setStatus("listening");
    setPartialUser("");
    // Allow the status ref effect to flush before arming.
    setTimeout(() => {
      if (inCallRef.current && statusRef.current === "listening") armRecorder();
    }, 0);
  }, [armRecorder]);

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

  // ---- Command handling ----
  const handleTranscript = useCallback(
    async (text: string) => {
      const userMsg: CallMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setPartialUser("");

      const active = controllerRef.current?.getActiveContext?.() ?? null;
      const recent = messagesRef.current
        .slice(-6)
        .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content)
        .join("\n");

      let cmd;
      try {
        cmd = await interpretFn({
          data: {
            utterance: text,
            recentTranscript: recent,
            activeDocTitle: active?.title,
            activeDocIndex: active?.currentIndex,
            activeSentences: active?.sentences.map((s, i) => ({ index: i, content: s.content })),
          },
        });
      } catch (e) {
        console.warn("[call] interpret error", e);
        cmd = null;
      }

      const say = async (reply: string) => {
        if (!reply) return;
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        if (!inCallRef.current) return;
        setStatus("speaking");
        await speakAsync(reply);
      };

      const action = cmd?.action ?? "chat";

      try {
        if (action === "end_call") {
          stopRecorder(true);
          setStatus("speaking");
          await speakAsync("Okay, talk to you later.");
          await endCallRef.current("phrase");
          return;
        }

        if (action === "jump") {
          if (!active) {
            await say("Open a document first, then I can jump around it.");
          } else if (cmd?.sentenceIndex == null) {
            await say("Which sentence should I jump to?");
          } else {
            const total = active.sentences.length;
            const idx = Math.max(0, Math.min(cmd.sentenceIndex, Math.max(0, total - 1)));
            await controllerRef.current?.jumpToIndex(idx);
            await say(`Jumped to sentence ${idx + 1}.`);
          }
        } else if (action === "open_doc") {
          setStatus("thinking");
          setActionLabel("Finding document…");
          const match = cmd?.docQuery ? await resolveDoc(cmd.docQuery, "read") : null;
          setActionLabel(null);
          if (!match) {
            await say("I couldn't find that document. What's the title?");
          } else {
            await controllerRef.current?.openDocumentById(match.id);
            await say(`Opening ${match.title}.`);
          }
        } else if (action === "find_doc") {
          setStatus("thinking");
          setActionLabel("Looking that up…");
          const match = cmd?.docQuery
            ? await resolveDoc(cmd.docQuery, "read", 0.3)
            : null;
          setActionLabel(null);
          await say(
            match
              ? `The title you may be referring to is "${match.title}".`
              : "I don't see a document that matches. Can you describe what it's about?",
          );
        } else if (action === "read_doc") {
          setStatus("reading");
          setActionLabel("Finding document…");
          let docId: string | null = null;
          let docTitle: string | null = null;
          if (cmd?.useActiveDoc && active) {
            docId = active.docId;
            docTitle = active.title;
          } else if (cmd?.docQuery) {
            const match = await resolveDoc(cmd.docQuery, "read");
            if (match) {
              docId = match.id;
              docTitle = match.title;
            }
          }
          if (!docId) {
            setActionLabel(null);
            await say("Which document should I read? Tell me the title.");
          } else {
            setActionLabel(`Reading "${docTitle}"…`);
            const { docs } = await readDocsFn({ data: { documentIds: [docId] } });
            setReadingDocs(docs);
            const contextMsg: CallMessage = {
              role: "assistant",
              content: docs
                .map(
                  (d) =>
                    `[document: "${d.title}"]\n` +
                    d.sentences.map((s, i) => `${i + 1}. ${s.content}`).join("\n"),
                )
                .join("\n\n"),
            };
            setMessages((prev) => [...prev, contextMsg]);
            setActionLabel(null);
            await say(`Got it. I've read ${docTitle}. What's your question?`);
          }
        } else if (action === "edit_sentence") {
          if (!active) {
            await say("Open the document first, then tell me which sentence to change.");
          } else if (!cmd?.newText) {
            await say("What should the new sentence say?");
          } else {
            const idx =
              cmd.sentenceIndex != null
                ? Math.max(0, Math.min(cmd.sentenceIndex, active.sentences.length - 1))
                : active.currentIndex;
            setStatus("adding");
            const res = await editSentenceFn({
              data: { documentId: active.docId, sentenceIndex: idx, newText: cmd.newText },
            });
            await controllerRef.current?.openDocumentById(active.docId);
            await say(
              res.updated
                ? `Updated sentence ${(res.sentenceIndex ?? idx) + 1} in ${active.title}.`
                : "I couldn't find that sentence to change.",
            );
          }
        } else if (action === "add_text") {
          if (!cmd?.newText) {
            await say("What would you like me to add?");
          } else {
            setStatus("adding");
            setActionLabel("Finding document…");
            let docId: string | null = null;
            let docTitle: string | null = null;
            if (cmd.useActiveDoc && active) {
              docId = active.docId;
              docTitle = active.title;
            } else if (cmd.docQuery) {
              const match = await resolveDoc(cmd.docQuery, "add");
              if (match) {
                docId = match.id;
                docTitle = match.title;
              }
            } else if (active) {
              docId = active.docId;
              docTitle = active.title;
            }
            setActionLabel(null);
            if (!docId) {
              await say("Which document should I add that to?");
            } else {
              const { inserted } = await addTextFn({
                data: { documentId: docId, text: cmd.newText },
              });
              if (active && docId === active.docId) {
                await controllerRef.current?.openDocumentById(docId);
              }
              await say(
                inserted > 0
                  ? `Added that to ${docTitle}.`
                  : "I couldn't find anything to add.",
              );
            }
          }
        } else if (action === "mark_delete") {
          setStatus("marking");
          let docId: string | null = null;
          let docTitle: string | null = null;
          if (cmd?.useActiveDoc && active) {
            docId = active.docId;
            docTitle = active.title;
          } else if (cmd?.docQuery) {
            const match = await resolveDoc(cmd.docQuery, "mark");
            if (match) {
              docId = match.id;
              docTitle = match.title;
            }
          } else if (readingDocsRef.current?.[0]) {
            docId = readingDocsRef.current[0].id;
            docTitle = readingDocsRef.current[0].title;
          } else if (active) {
            docId = active.docId;
            docTitle = active.title;
          }
          if (!docId) {
            await say("Which document are those sentences in?");
          } else {
            const { marked } = await markFn({ data: { documentId: docId, utterance: text } });
            await say(
              marked > 0
                ? `Marked ${marked} sentence${marked === 1 ? "" : "s"} in ${docTitle} for deletion.`
                : "I couldn't find a matching sentence to mark.",
            );
          }
        } else if (action === "rename_title") {
          if (!cmd?.newText) {
            await say("What should the new title be?");
          } else {
            setStatus("adding");
            setActionLabel("Finding document…");
            let docId: string | null = null;
            if (cmd.useActiveDoc && active) {
              docId = active.docId;
            } else if (cmd.docQuery) {
              const match = await resolveDoc(cmd.docQuery, "read");
              if (match) docId = match.id;
            } else if (active) {
              docId = active.docId;
            }
            setActionLabel(null);
            if (!docId) {
              await say("Which document should I rename?");
            } else {
              const res = await renameFn({ data: { documentId: docId, newTitle: cmd.newText } });
              if (active && docId === active.docId) {
                await controllerRef.current?.openDocumentById(docId);
              }
              await say(
                res.oldTitle
                  ? `Renamed "${res.oldTitle}" to "${res.newTitle}".`
                  : `Renamed it to "${res.newTitle}".`,
              );
            }
          }
        } else {
          // Normal conversation.
          setStatus("thinking");
          let reply = "";
          try {
            const res = await callChat({
              data: { messages: [...messagesRef.current, userMsg] },
            });
            reply = (res?.text ?? "").trim();
          } catch (e) {
            reply = "Sorry, I didn't catch that. Could you say it again?";
            console.warn("[call] chat error", e);
          }
          await say(reply);
        }
      } catch (e) {
        console.warn("[call] action error", e);
        setStatus("speaking");
        await speakAsync("Sorry, something went wrong with that.");
      } finally {
        setActionLabel(null);
      }

      if (!inCallRef.current) return;
      backToListening();
    },
    [
      interpretFn,
      callChat,
      speakAsync,
      stopRecorder,
      backToListening,
      resolveDoc,
      readDocsFn,
      addTextFn,
      markFn,
      editSentenceFn,
      renameFn,
    ],
  );

  // process a recorded segment: transcribe → handle.
  const processSegment = useCallback(
    async (blob: Blob) => {
      if (!inCallRef.current || sendingRef.current) return;
      sendingRef.current = true;
      try {
        setStatus("thinking");
        let text = "";
        try {
          const base64 = await blobToBase64(blob);
          const res = await transcribeFn({
            data: { audioBase64: base64, mimeType: mimeTypeRef.current },
          });
          text = (res?.text ?? "").trim();
        } catch (e) {
          console.warn("[call] transcription error", e);
        }
        if (!inCallRef.current) return;
        if (!text || text.replace(/[^a-z0-9]/gi, "").length < 2) {
          backToListening();
          return;
        }
        await handleTranscript(text);
      } finally {
        sendingRef.current = false;
      }
    },
    [transcribeFn, handleTranscript, backToListening],
  );
  useEffect(() => { processSegmentRef.current = processSegment; }, [processSegment]);

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

  // ---- Teardown audio ----
  const teardownAudio = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopRecorder(true);
    try { analyserRef.current?.disconnect(); } catch {}
    analyserRef.current = null;
    try { void audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    }
    streamRef.current = null;
  }, [stopRecorder]);

  // ---- Public: start / end ----
  const startCall = useCallback(async () => {
    if (inCallRef.current) return;

    const hasMR = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
    const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;
    const hasGUM =
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    if (!hasMR || !hasTTS || !hasGUM) {
      toast.error(
        "Voice calls aren't supported in this browser. Try Safari on iPhone or Chrome on desktop.",
      );
      return;
    }

    // Open a persistent mic stream (must be from a user gesture on iOS).
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      toast.error("Microphone access denied");
      return;
    }
    streamRef.current = stream;
    mimeTypeRef.current = pickMimeType();

    // Audio graph for VAD.
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
    } catch (e) {
      console.warn("[call] audio graph failed", e);
    }

    setInCall(true);
    setMessages([]);
    setPartialUser("");
    setMicMuted(false);
    // Start already minimized so the user sees the live app + yellow orb.
    setOverlayMinimized(true);
    setStatus("speaking");

    void requestWakeLock();

    // Greeting — inside the gesture chain to unlock iOS TTS.
    const greeting = "I'm here.";
    setMessages([{ role: "assistant", content: greeting }]);
    await speakAsync(greeting);
    if (!inCallRef.current) return;

    // Start the VAD loop and begin listening.
    rafRef.current = requestAnimationFrame(vadTick);
    backToListening();
  }, [speakAsync, requestWakeLock, vadTick, backToListening]);

  const endCall = useCallback(
    async (_reason?: "user" | "phrase" | "error") => {
      if (!inCallRef.current) return;
      setStatus("ending");
      teardownAudio();
      try { window.speechSynthesis?.cancel(); } catch {}
      await releaseWakeLock();
      setInCall(false);
      setStatus("idle");
      setPartialUser("");
      setReadingDocs(null);
      setActionLabel(null);
      setOverlayMinimized(false);
    },
    [releaseWakeLock, teardownAudio],
  );
  useEffect(() => { endCallRef.current = endCall; }, [endCall]);

  const toggleMicMute = useCallback(() => {
    setMicMuted((m) => {
      const next = !m;
      if (next) {
        // Drop any in-flight segment.
        stopRecorder(true);
      } else if (inCallRef.current && statusRef.current === "listening") {
        setTimeout(() => armRecorder(), 0);
      }
      return next;
    });
  }, [stopRecorder, armRecorder]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      teardownAudio();
      try { window.speechSynthesis?.cancel(); } catch {}
      void releaseWakeLock();
    };
  }, [releaseWakeLock, teardownAudio]);

  // Re-arm on visibility return.
  useEffect(() => {
    const onVis = () => {
      if (!inCallRef.current || document.hidden) return;
      if (audioCtxRef.current?.state === "suspended") {
        void audioCtxRef.current.resume();
      }
      if (statusRef.current === "listening" && !recorderRef.current && !micMutedRef.current) {
        armRecorder();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [armRecorder]);

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
