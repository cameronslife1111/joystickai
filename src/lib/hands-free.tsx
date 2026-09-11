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
import { toast } from "@/lib/toast";
import { PhoneOff } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLiveVoice, type CallState } from "@/lib/use-live-voice";
import { buildLiveDocContext } from "@/lib/live.functions";
import { processChatTurn } from "@/lib/chat-turn.functions";
import { normalizeCapabilities, type ChatCapabilities } from "@/lib/chat-types";
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
  start: (threadId: string, context: string, caps?: ChatCapabilities) => Promise<void>;
  stop: () => void;
};

const HandsFreeContext = createContext<HandsFreeApi | null>(null);

/** How often the live call re-checks its thread's attached documents. */
const DOC_POLL_MS = 2_500;
/** How often the call looks for new backend results to speak. */
const RESULT_POLL_MS = 3_000;


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

  /**
   * GPT-Live asked for real work. It only runs the conversation, so the request
   * goes into Orby's own queued chat turn — same runner, same planner, same
   * ownership checks as a typed message.
   */
  const runDelegated = useCallback(
    async (delegationId: string) => {
      const tid = threadIdRef.current;
      const uid = userIdRef.current;
      const text = lastUserTextRef.current.trim();
      if (!tid || !uid || !text) return;
      if (pendingTurnRef.current) return; // one backend job per call at a time
      pendingTurnRef.current = true;
      voiceRef.current.appendThinking(
        "Your backend has started this request. Nothing is finished yet — keep the user company and " +
          "report the outcome only when a result arrives.",
        delegationId,
      );
      try {
        const history = ((qc.getQueryData<any[]>(["chat_messages", tid]) ?? []) as any[])
          .slice(-20)
          .map((m) => ({
            role: m.kind === "plan" ? "assistant" : m.role,
            content:
              m.kind === "plan"
                ? "[A plan was kicked off here and ran in the background.]"
                : (m.content ?? ""),
          }))
          .filter((m) => (m.content ?? "").trim().length > 0);

        const { data: threadRow } = await supabase
          .from("chat_threads")
          .select("auto_approve_plans")
          .eq("id", tid)
          .maybeSingle();

        const { data: turnRow, error } = await supabase
          .from("chat_turns")
          .insert({
            user_id: uid,
            thread_id: tid,
            status: "pending",
            payload: {
              userText: text,
              messages: history,
              contextDocumentIds: docIdsRef.current,
              imageUrls: [],
              capabilities: capsRef.current,
              autoCapabilities: false,
              autoApprove: !!(threadRow as any)?.auto_approve_plans,
            } as any,
          } as any)
          .select("id")
          .single();
        if (error || !turnRow) throw error ?? new Error("Couldn't start that");
        await runTurn({ data: { turnId: (turnRow as any).id as string } }).catch(() => {});
      } catch (e) {
        voiceRef.current.appendCommentary(
          "That request couldn't be started just now. Tell the user briefly and offer to try again.",
          delegationId,
        );
      } finally {
        pendingTurnRef.current = false;
      }
    },
    [qc, runTurn],
  );

  const voice = useLiveVoice({
    buildContext: useCallback(() => contextRef.current, []),
    buildDocumentIds: useCallback(() => docIdsRef.current, []),
    buildThreadId: useCallback(() => threadIdRef.current, []),
    onUserText: useCallback(
      (t: string) => {
        lastUserTextRef.current = t;
        void appendMessage("user", t);
      },
      [appendMessage],
    ),
    onAssistantText: useCallback(
      (t: string) => void appendMessage("assistant", t),
      [appendMessage],
    ),
    onDelegation: useCallback((id: string) => void runDelegated(id), [runDelegated]),
    onError: useCallback((m: string) => toast.error(m), []),
  });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const stop = useCallback(() => {
    voiceRef.current.stop();
    setThreadId(null);
    docIdsRef.current = [];
    pushedDocsRef.current = "";
    spokenIdsRef.current = new Set();
    pendingTurnRef.current = false;
  }, []);

  const start = useCallback(
    async (tid: string, context: string, caps?: ChatCapabilities) => {
      if (!tid) return;
      // Nothing else in the app may speak over the call.
      cancelSpeech();
      contextRef.current = context;
      const { data } = await supabase
        .from("chat_threads")
        .select("attached_document_ids, capabilities")
        .eq("id", tid)
        .single();
      docIdsRef.current = (data?.attached_document_ids as string[] | null) ?? [];
      pushedDocsRef.current = docIdsRef.current.join(",");
      capsRef.current = normalizeCapabilities(caps ?? (data as any)?.capabilities);
      // Only results created after the call starts get spoken.
      watermarkRef.current = new Date().toISOString();
      spokenIdsRef.current = new Set();
      lastUserTextRef.current = "";
      threadIdRef.current = tid;
      setThreadId(tid);
      await voiceRef.current.start();
    },
    [],
  );

  // Anything Orby's backend posts into this thread while the call is live —
  // a plan kickoff line, a finished plan's wrap-up, a normal reply — is handed
  // to the live voice so she can say it in her own words.
  useEffect(() => {
    if (!voice.live || !threadId) return;
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const { data } = await supabase
          .from("chat_messages")
          .select("id, role, content, created_at, kind")
          .eq("thread_id", threadId)
          .eq("role", "assistant")
          .gt("created_at", watermarkRef.current)
          .order("created_at", { ascending: true })
          .limit(10);
        for (const row of (data ?? []) as any[]) {
          if (cancelled) return;
          if (spokenIdsRef.current.has(row.id)) continue;
          spokenIdsRef.current.add(row.id);
          const text = toPlainText(row.content ?? "").trim();
          if (!text) continue;
          voiceRef.current.appendCommentary(
            `Result from your backend — tell the user this in your own words, briefly:\n${text}`,
          );
          qc.invalidateQueries({ queryKey: ["chat_messages", threadId] });
        }
      } catch {
        /* transient — the next tick retries */
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void tick(), RESULT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [voice.live, threadId, qc]);


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
          data: { documentIds: ids, threadId },
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
