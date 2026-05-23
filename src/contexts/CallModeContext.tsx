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
import { supabase } from "@/integrations/supabase/client";
import { chatWithOrby } from "@/lib/orby-call.functions";
import {
  isEndCallPhrase,
  isMakePlanPhrase,
  isReadDocPhrase,
  isAddTextPhrase,
  isMarkDeletePhrase,
} from "@/lib/call-phrases";
import {
  resolveDocumentsByVoice,
  readDocumentsForCall,
  addTextToDocument,
  markSentencesForDeletion,
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

interface CallModeContextValue {
  inCall: boolean;
  status: CallStatus;
  messages: CallMessage[];
  partialUser: string;
  micMuted: boolean;
  startCall: () => Promise<void>;
  endCall: (reason?: "user" | "phrase" | "error" | "plan") => Promise<void>;
  toggleMicMute: () => void;
  overlayMinimized: boolean;
  setOverlayMinimized: (v: boolean) => void;
  generatePlanFromConversation: () => Promise<void>;
  readingDocs: ReadingDoc[] | null;
  dismissReadingDocs: () => void;
  actionLabel: string | null;
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

  const resolveDocsFn = useServerFn(resolveDocumentsByVoice);
  const readDocsFn = useServerFn(readDocumentsForCall);
  const addTextFn = useServerFn(addTextToDocument);
  const markFn = useServerFn(markSentencesForDeletion);

  const inCallRef = useRef(false);
  const micMutedRef = useRef(false);
  const statusRef = useRef<CallStatus>("idle");
  const recogRef = useRef<any>(null);
  const lastSpeechAtRef = useRef<number>(0);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const wakeLockRef = useRef<any>(null);

  const callChat = useServerFn(chatWithOrby);

  // Keep refs in sync.
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const clearPauseTimer = () => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  };
  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  // ---- TTS ----
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

  // ---- Recognition (webkitSpeechRecognition) ----
  const startRecognition = useCallback(() => {
    if (!inCallRef.current) return;
    if (typeof window === "undefined") return;
    const SR =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SR) return;
    if (recogRef.current) return; // already running

    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onstart = () => {
        if (statusRef.current === "listening" || statusRef.current === "idle") {
          setStatus("listening");
        }
      };

      rec.onresult = (e: any) => {
        if (micMutedRef.current) return;
        let interim = "";
        let finalText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const txt = res[0]?.transcript ?? "";
          if (res.isFinal) finalText += txt + " ";
          else interim += txt + " ";
        }
        lastSpeechAtRef.current = Date.now();
        if (interim) setPartialUser(interim.trim());
        if (finalText.trim()) {
          setPartialUser(finalText.trim());
          schedulePauseCommit();
        } else if (interim.trim()) {
          schedulePauseCommit();
        }
      };

      rec.onerror = (_e: any) => {
        // Common: "no-speech", "aborted", "network". Just let onend restart.
      };

      rec.onend = () => {
        recogRef.current = null;
        // If still in call and not speaking/thinking, auto-restart shortly.
        if (
          inCallRef.current &&
          (statusRef.current === "listening" || statusRef.current === "idle")
        ) {
          clearRestartTimer();
          restartTimerRef.current = setTimeout(() => startRecognition(), 250);
        }
      };

      recogRef.current = rec;
      rec.start();
    } catch {
      recogRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    clearRestartTimer();
    clearPauseTimer();
    const r = recogRef.current;
    if (r) {
      try { r.onend = null; r.onresult = null; r.onerror = null; } catch {}
      try { r.stop(); } catch {}
      try { r.abort(); } catch {}
      recogRef.current = null;
    }
  }, []);

  // Pause-detection: commit when user has been quiet ~1.2s after their last
  // recognized result.
  const schedulePauseCommit = () => {
    clearPauseTimer();
    pauseTimerRef.current = setTimeout(() => {
      const text = (partialUserRef.current || "").trim();
      if (!text) return;
      void commitUtterance(text);
    }, 3200);
  };

  // We need a ref mirror of partialUser to read inside timer callbacks.
  const partialUserRef = useRef("");
  useEffect(() => { partialUserRef.current = partialUser; }, [partialUser]);

  // Forward-references to endCall / generatePlan, populated after their
  // useCallback declarations below. Using refs avoids TDZ issues.
  const endCallRef = useRef<(reason?: "user" | "phrase" | "error" | "plan") => Promise<void>>(
    async () => {},
  );
  const generatePlanRef = useRef<(msgs: CallMessage[]) => Promise<void>>(async () => {});

  // ---- Turn-taking ----
  const commitUtterance = useCallback(
    async (text: string) => {
      if (!inCallRef.current || sendingRef.current) return;
      sendingRef.current = true;
      try {
        setPartialUser("");

        // Append user message first so plan generation later includes it.
        const userMsg: CallMessage = { role: "user", content: text };
        setMessages((prev) => [...prev, userMsg]);

        // Phrase shortcuts.
        if (isEndCallPhrase(text)) {
          stopRecognition();
          setStatus("speaking");
          await speakAsync("Okay, talk to you later.");
          await endCallRef.current("phrase");
          return;
        }

        if (isMakePlanPhrase(text)) {
          stopRecognition();
          setStatus("speaking");
          await speakAsync("Got it, I'll generate that plan now.");
          await generatePlanRef.current([...messagesRef.current, userMsg]);
          await endCallRef.current("plan");
          return;
        }

        // Normal AI turn.
        setStatus("thinking");
        stopRecognition();
        let reply = "";
        try {
          const res = await callChat({
            data: { messages: [...messagesRef.current, userMsg] },
          });
          reply = (res?.text ?? "").trim();
        } catch (e: any) {
          reply = "Sorry, I didn't catch that. Could you say it again?";
          console.warn("[call] chat error", e);
        }
        if (!inCallRef.current) return;
        if (reply) {
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
          setStatus("speaking");
          await speakAsync(reply);
        }
        if (!inCallRef.current) return;
        setStatus("listening");
        startRecognition();
      } finally {
        sendingRef.current = false;
      }
    },
    [callChat, speakAsync, startRecognition, stopRecognition],
  );

  // Mirror messages so commitUtterance can read latest without re-binding.
  const messagesRef = useRef<CallMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ---- Plan generation from full transcript ----
  const generatePlanFromConversationInternal = useCallback(
    async (msgs: CallMessage[]) => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) {
          toast.error("Sign in first");
          return;
        }
        const transcript = msgs
          .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content)
          .join("\n");
        const userRequest =
          "Turn the following voice conversation between the user and Orby into a concrete plan. " +
          "Capture every concrete intent, decision, or task the user expressed.\n\n" +
          "===== Conversation transcript =====\n" +
          transcript;
        const { data: row, error } = await supabase
          .from("plans")
          .insert({
            user_id: u.user.id,
            status: "composing",
            user_request: userRequest,
            attached_document_ids: [],
          })
          .select()
          .single();
        if (error || !row) throw new Error(error?.message || "Failed to create plan");
        void supabase.functions.invoke("plan-compose", { body: { plan_id: row.id } });
        toast("Orby is generating your plan from the call…", { duration: 4000 });
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't generate plan");
      }
    },
    [],
  );

  const generatePlanFromConversation = useCallback(async () => {
    await generatePlanFromConversationInternal(messagesRef.current);
  }, [generatePlanFromConversationInternal]);

  // ---- Wake lock (best effort) ----
  const requestWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as any).wakeLock;
      if (wl?.request) {
        wakeLockRef.current = await wl.request("screen");
      }
    } catch {}
  }, []);
  const releaseWakeLock = useCallback(async () => {
    try { await wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
  }, []);

  // ---- Public: start / end ----
  const startCall = useCallback(async () => {
    if (inCallRef.current) return;

    // Browser support check.
    const hasSR =
      typeof window !== "undefined" &&
      ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;
    if (!hasSR || !hasTTS) {
      toast.error(
        "Voice calls aren't supported in this browser. Try Safari on iPhone or Chrome on desktop.",
      );
      return;
    }

    // Pre-warm mic permission. On iOS this MUST be from a user gesture (caller
    // must invoke startCall directly from a tap handler).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // We don't need the stream itself — SpeechRecognition opens its own.
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      toast.error("Microphone access denied");
      return;
    }

    setInCall(true);
    setMessages([]);
    setPartialUser("");
    setMicMuted(false);
    setOverlayMinimized(false);
    setStatus("speaking");

    void requestWakeLock();

    // Greeting — must speak inside the same gesture chain to unlock iOS TTS.
    const greeting = "Hey, I'm listening. What's on your mind?";
    setMessages([{ role: "assistant", content: greeting }]);
    await speakAsync(greeting);
    if (!inCallRef.current) return;
    setStatus("listening");
    startRecognition();
  }, [speakAsync, startRecognition, requestWakeLock]);

  const endCall = useCallback(
    async (_reason?: "user" | "phrase" | "error" | "plan") => {
      if (!inCallRef.current) return;
      setStatus("ending");
      stopRecognition();
      try { window.speechSynthesis?.cancel(); } catch {}
      await releaseWakeLock();
      setInCall(false);
      setStatus("idle");
      setPartialUser("");
      setOverlayMinimized(false);
    },
    [releaseWakeLock, stopRecognition],
  );

  const toggleMicMute = useCallback(() => {
    setMicMuted((m) => !m);
  }, []);

  // Wire forward refs now that endCall / generatePlan are defined.
  useEffect(() => { endCallRef.current = endCall; }, [endCall]);
  useEffect(() => {
    generatePlanRef.current = generatePlanFromConversationInternal;
  }, [generatePlanFromConversationInternal]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopRecognition();
      try { window.speechSynthesis?.cancel(); } catch {}
      void releaseWakeLock();
    };
  }, [releaseWakeLock, stopRecognition]);

  // Resume audio context / re-arm recognition on visibility return.
  useEffect(() => {
    const onVis = () => {
      if (!inCallRef.current) return;
      if (document.hidden) return;
      if (statusRef.current === "listening" && !recogRef.current) {
        startRecognition();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [startRecognition]);

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
      generatePlanFromConversation,
      readingDocs,
      dismissReadingDocs,
      actionLabel,
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
      generatePlanFromConversation,
      readingDocs,
      dismissReadingDocs,
      actionLabel,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
