import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PhoneOff } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useRealtimeVoice, type CallState } from "@/lib/use-realtime-voice";
import { buildRealtimeDocContext } from "@/lib/realtime.functions";
import { toPlainText } from "@/lib/plain-text";
import { cancelSpeech, setSpeechSuppressed } from "@/lib/speech";

type HandsFreeApi = {
  state: CallState;
  live: boolean;
  connecting: boolean;
  speaking: boolean;
  /** Thread the live (or connecting) call belongs to. */
  threadId: string | null;
  /** Start a call for `threadId`; `context` is the recent conversation text. */
  start: (threadId: string, context: string) => Promise<void>;
  stop: () => void;
};

const HandsFreeContext = createContext<HandsFreeApi | null>(null);

/** How often the live call re-checks its thread's attached documents. */
const DOC_POLL_MS = 2_500;

export function HandsFreeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const fetchDocContext = useServerFn(buildRealtimeDocContext);

  const [threadId, setThreadId] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  const userIdRef = useRef<string | null>(null);
  const contextRef = useRef<string>("");
  const docIdsRef = useRef<string[]>([]);
  /** Serialized doc-id list currently pushed into the live session. */
  const pushedDocsRef = useRef<string>("");

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      userIdRef.current = data.user?.id ?? null;
    });
  }, []);

  const bumpThread = useCallback(
    (id: string, assistant: boolean) => {
      const now = new Date().toISOString();
      const patch: { updated_at: string; last_assistant_at?: string } = { updated_at: now };
      if (assistant) patch.last_assistant_at = now;
      void supabase
        .from("chat_threads")
        .update(patch)
        .eq("id", id)
        .then(() => {
          qc.invalidateQueries({ queryKey: ["chat_threads"] });
          qc.invalidateQueries({ queryKey: ["chat_unread"] });
        });
    },
    [qc],
  );

  /** Persist a spoken turn into the call's thread so it appears in the chat. */
  const appendMessage = useCallback(
    async (role: "user" | "assistant", content: string) => {
      const tid = threadIdRef.current;
      const uid = userIdRef.current;
      if (!tid || !uid) return;
      const text = role === "assistant" ? toPlainText(content) : content.trim();
      if (!text) return;
      const { data: row, error } = await supabase
        .from("chat_messages")
        .insert({ user_id: uid, thread_id: tid, role, content: text, kind: "text" })
        .select("id, role, content, created_at, kind, plan_id")
        .single();
      if (error || !row) return;
      qc.setQueryData<any[]>(["chat_messages", tid], (cur) => [...(cur ?? []), row]);
      // Keep the call's rolling context in step with what was actually said.
      contextRef.current = `${contextRef.current}\n${role === "user" ? "User: " : "Orby: "}${text}`
        .split("\n")
        .slice(-20)
        .join("\n");
      bumpThread(tid, role === "assistant");
    },
    [qc, bumpThread],
  );

  const voice = useRealtimeVoice({
    buildContext: useCallback(() => contextRef.current, []),
    buildDocumentIds: useCallback(() => docIdsRef.current, []),
    onUserText: useCallback((t: string) => void appendMessage("user", t), [appendMessage]),
    onAssistantText: useCallback(
      (t: string) => void appendMessage("assistant", t),
      [appendMessage],
    ),
    onError: useCallback((m: string) => toast.error(m), []),
  });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const stop = useCallback(() => {
    voiceRef.current.stop();
    setThreadId(null);
    docIdsRef.current = [];
    pushedDocsRef.current = "";
  }, []);

  const start = useCallback(
    async (tid: string, context: string) => {
      if (!tid) return;
      // Nothing else in the app may speak over the call.
      cancelSpeech();
      contextRef.current = context;
      const { data } = await supabase
        .from("chat_threads")
        .select("attached_document_ids")
        .eq("id", tid)
        .single();
      docIdsRef.current = (data?.attached_document_ids as string[] | null) ?? [];
      pushedDocsRef.current = docIdsRef.current.join(",");
      threadIdRef.current = tid;
      setThreadId(tid);
      await voiceRef.current.start();
    },
    [],
  );

  // While a call is live nothing else in the app is allowed to speak, so
  // sentence reading, cues and chat read-aloud never talk over Orby.
  useEffect(() => {
    setSpeechSuppressed(voice.live || voice.connecting);
    return () => setSpeechSuppressed(false);
  }, [voice.live, voice.connecting]);

  // Keep the call's attached documents current — even with the chat closed —
  // by polling the thread row the call belongs to.
  useEffect(() => {
    if (!voice.live || !threadId) return;
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const { data } = await supabase
          .from("chat_threads")
          .select("attached_document_ids")
          .eq("id", threadId)
          .single();
        const ids = ((data?.attached_document_ids as string[] | null) ?? []).filter(Boolean);
        const key = ids.join(",");
        if (cancelled || key === pushedDocsRef.current) return;
        pushedDocsRef.current = key;
        docIdsRef.current = ids;
        const { block, included, trimmed } = await fetchDocContext({
          data: { documentIds: ids },
        });
        if (cancelled) return;
        if (!voiceRef.current.updateContext(block)) return;
        if (included === 0) {
          toast.success("Orby is no longer seeing any documents");
        } else {
          toast.success(
            `Orby can now see ${included} document${included === 1 ? "" : "s"}` +
              (trimmed ? " (trimmed to fit)" : ""),
          );
        }
      } catch {
        /* transient — the next tick retries */
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void tick(), DOC_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [voice.live, threadId, fetchDocContext]);

  const api = useMemo<HandsFreeApi>(
    () => ({
      state: voice.state,
      live: voice.live,
      connecting: voice.connecting,
      speaking: voice.speaking,
      threadId,
      start,
      stop,
    }),
    [voice.state, voice.live, voice.connecting, voice.speaking, threadId, start, stop],
  );

  return <HandsFreeContext.Provider value={api}>{children}</HandsFreeContext.Provider>;
}

export function useHandsFree(): HandsFreeApi {
  const ctx = useContext(HandsFreeContext);
  if (!ctx) throw new Error("useHandsFree must be used inside HandsFreeProvider");
  return ctx;
}

/**
 * Floating reminder that a hands-free call is still running while the user is
 * elsewhere in the app. Tapping it ends the call.
 */
export function HandsFreeIndicator({ hidden }: { hidden?: boolean }) {
  const call = useHandsFree();
  if (hidden || !(call.live || call.connecting)) return null;
  return (
    <button
      type="button"
      onClick={call.stop}
      className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-lg"
      style={{ WebkitTouchCallout: "none", userSelect: "none" }}
      aria-label="End hands-free call"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" />
      </span>
      {call.connecting ? "Connecting…" : call.speaking ? "Orby is speaking" : "Hands-free live"}
      <PhoneOff className="h-4 w-4" />
    </button>
  );
}
