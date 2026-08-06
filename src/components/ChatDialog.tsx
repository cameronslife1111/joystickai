import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  Paperclip,
  X,
  Play,
  Square,
  Copy,
  FileDown,
  Send,
  Trash2,
  Image as ImageIcon,
  Plus,
  Pencil,
  MessagesSquare,
  Menu,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { sendChatMessage, generateThreadTitle, type ChatCapabilities } from "@/lib/chat.functions";
import { splitIntoSentences } from "@/lib/sentences";
import { useVoiceDictation, appendTranscript } from "@/lib/use-voice-dictation";
import { useRealtimeVoice } from "@/lib/use-realtime-voice";

import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { sortDocsByTitle } from "@/lib/sortDocs";
import { toPlainText } from "@/lib/plain-text";

import { StepReasoning } from "./plan/StepReasoning";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocumentId: string | null;
  documents: { id: string; title: string }[];
  /** When provided while opening, select this thread instead of the default. */
  openThreadId?: string | null;
  /** Open straight to the chat list instead of the last conversation. */
  startInThreadList?: boolean;
  /** Open an attached document in the reader (chat closes first). */
  onOpenDocument?: (documentId: string) => void;
  /**
   * 🟣 Delegate (menu slot 15): open a brand-new thread with `documentId`
   * attached and immediately send `prompt` with `capabilities` checked.
   * `id` is a nonce so each tap fires exactly once.
   */
  delegate?: {
    id: string;
    documentId: string;
    title: string;
    prompt: string;
    capabilities: ChatCapabilities;
  } | null;

}

type ChatRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  kind: string;
  plan_id: string | null;
};

type Thread = {
  id: string;
  title: string;
  attached_document_ids: string[];
  capabilities: ChatCapabilities;
  updated_at: string;
};

const DEFAULT_CAPS: ChatCapabilities = {
  web_search: true,
  image_analysis: true,
  planning: true,
  image_generation: true,
  video_generation: true,
  document_editing: true,
  scheduling: true,
};

/** Nothing checked → Orby just replies with text. */
const NO_CAPS: ChatCapabilities = {
  web_search: false,
  image_analysis: false,
  planning: false,
  image_generation: false,
  video_generation: false,
  document_editing: false,
  scheduling: false,
};



const CAP_LABELS: { key: keyof ChatCapabilities; label: string; hint: string }[] = [
  { key: "planning", label: "Planning / multi-step", hint: "Combine steps to complete bigger tasks" },
  { key: "document_editing", label: "Document editing", hint: "Create, edit, organize your documents" },
  { key: "image_generation", label: "Image generation", hint: "Create & remix images to your gallery" },
  { key: "video_generation", label: "Video generation", hint: "Make videos to your gallery" },
  { key: "scheduling", label: "Scheduling", hint: "Create, edit, pause scheduled plans" },
  { key: "web_search", label: "Web search", hint: "Look up current info online" },
  { key: "image_analysis", label: "Image analysis", hint: "Describe & analyze attached images" },
];

// action groups that map to plan tool groups
const ACTION_TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
  "web_search",
];

const stripEmoji = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// Speak a short phrase with no message-bubble binding (cues, plan announcements).
function speakPlain(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const clean = stripEmoji(text);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

// Pick a cute spoken cue from a plan's summary + step descriptions.
function planActionCue(plan: { plan_summary: string | null; steps: PlanStep[] | null }): string {
  const text = [
    plan.plan_summary ?? "",
    ...(Array.isArray(plan.steps) ? plan.steps.map((s) => s?.description ?? "") : []),
  ]
    .join(" ")
    .toLowerCase();
  if (/\bvideo/.test(text)) return "Making those videos now";
  if (/\bimage|picture|photo|remix/.test(text)) return "Generating that image now";
  if (/\bdocument|sentence|rewrite|edit|organiz/.test(text)) return "Editing your document now";
  return "Working on that now";
}

function normalizeCaps(raw: any): ChatCapabilities {
  return { ...DEFAULT_CAPS, ...(raw && typeof raw === "object" ? raw : {}) };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function ChatDialog({ open, onOpenChange, currentDocumentId, documents, openThreadId, startInThreadList, onOpenDocument, delegate }: Props) {
  const qc = useQueryClient();
  const send = useServerFn(sendChatMessage);
  const nameThread = useServerFn(generateThreadTitle);

  const [userId, setUserId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  /** One-shot capability checkboxes — reset after every send / thread switch. */
  const [pendingCaps, setPendingCaps] = useState<ChatCapabilities>(NO_CAPS);
  const [busyThreadIds, setBusyThreadIds] = useState<Set<string>>(new Set());
  const markBusy = (id: string) =>
    setBusyThreadIds((cur) => {
      const next = new Set(cur);
      next.add(id);
      return next;
    });
  const markIdle = (id: string) =>
    setBusyThreadIds((cur) => {
      if (!cur.has(id)) return cur;
      const next = new Set(cur);
      next.delete(id);
      return next;
    });
  const [pickedImages, setPickedImages] = useState<MediaAsset[]>([]);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [insertFor, setInsertFor] = useState<ChatRow | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteThreadId, setDeleteThreadId] = useState<string | null>(null);
  const [renameThread, setRenameThread] = useState<Thread | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootstrappedRef = useRef(false);
  /** Nonce of the last 🟣 Delegate request we already kicked off. */
  const delegateRef = useRef<string | null>(null);


  // 🔴 / ⬛️ voice dictation — appends the transcript to the message box.
  const dictation = useVoiceDictation(
    useCallback((text: string) => {
      setInput((prev) => appendTranscript(prev, text));
      setTimeout(() => textareaRef.current?.focus(), 50);
    }, []),
  );


  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Load the client-only "read replies aloud" preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setAutoSpeak(window.localStorage.getItem("orby_chat_autospeak") === "1");
    } catch {}
  }, []);

  const setAutoSpeakPref = (next: boolean) => {
    setAutoSpeak(next);
    try {
      window.localStorage.setItem("orby_chat_autospeak", next ? "1" : "0");
    } catch {}
    if (!next && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    }
  };

  const { data: threads = [], isFetched: threadsFetched } = useQuery({
    queryKey: ["chat_threads", userId],
    enabled: !!userId && open,
    queryFn: async (): Promise<Thread[]> => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("id, title, attached_document_ids, capabilities, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id,
        title: t.title,
        attached_document_ids: t.attached_document_ids ?? [],
        capabilities: normalizeCaps(t.capabilities),
        updated_at: t.updated_at,
      }));
    },
  });

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );
  const caps = pendingCaps;
  const contextDocIds = activeThread?.attached_document_ids ?? [];
  const isActiveBusy = activeThreadId ? busyThreadIds.has(activeThreadId) : false;

  const createThread = async (title = "New chat"): Promise<Thread | null> => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from("chat_threads")
      .insert({ user_id: userId, title, capabilities: DEFAULT_CAPS })
      .select("id, title, attached_document_ids, capabilities, updated_at")
      .single();
    if (error || !data) {
      toast.error("Couldn't create thread");
      return null;
    }
    const t: Thread = {
      id: data.id,
      title: data.title,
      attached_document_ids: data.attached_document_ids ?? [],
      capabilities: normalizeCaps(data.capabilities),
      updated_at: data.updated_at,
    };
    qc.setQueryData<Thread[]>(["chat_threads", userId], (cur) => [t, ...(cur ?? [])]);
    return t;
  };

  // Bootstrap: pick a thread when the dialog opens. Prefer the explicitly
  // requested thread, then the last chat the user was on, then the most
  // recent thread. Only create a new thread when the user has none.
  useEffect(() => {
    if (!open) {
      bootstrappedRef.current = false;
      return;
    }
    // 🟣 Delegate owns the bootstrap: it creates its own fresh thread.
    if (delegate && delegateRef.current !== delegate.id) return;
    // Slot 11 opens the chat picker first so the user chooses where to go.
    if (!bootstrappedRef.current) setDrawerOpen(!!startInThreadList && !openThreadId);
    if (bootstrappedRef.current || !userId) return;

    // Wait until the threads query has actually finished — the default `[]`
    // from useQuery would otherwise trick us into creating a new thread
    // before the real list arrives.
    if (!threadsFetched) return;
    bootstrappedRef.current = true;
    (async () => {
      const savedId =
        typeof window !== "undefined"
          ? window.localStorage.getItem("orby_last_thread")
          : null;
      if (openThreadId && threads.some((t) => t.id === openThreadId)) {
        setActiveThreadId(openThreadId);
      } else if (savedId && threads.some((t) => t.id === savedId)) {
        setActiveThreadId(savedId);
      } else if (threads.length > 0) {
        setActiveThreadId(threads[0].id);
      } else {
        const t = await createThread("Chat");
        if (t) setActiveThreadId(t.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, threadsFetched, threads, openThreadId]);

  // If a caller flips openThreadId while the dialog is ALREADY open (e.g.
  // tapping the "Open" action on a voice-note toast), jump to that thread.
  useEffect(() => {
    if (!open || !openThreadId) return;
    if (openThreadId === activeThreadId) return;
    if (!threads.some((t) => t.id === openThreadId)) return;
    setActiveThreadId(openThreadId);
    setDrawerOpen(false);
  }, [open, openThreadId, threads, activeThreadId]);

  // Remember the last chat the user was on so re-opening returns to it.
  useEffect(() => {
    if (activeThreadId && typeof window !== "undefined") {
      window.localStorage.setItem("orby_last_thread", activeThreadId);
    }
  }, [activeThreadId]);

  // Capability checkboxes never carry across threads or dialog sessions.
  useEffect(() => {
    setPendingCaps(NO_CAPS);
  }, [activeThreadId, open]);

  const { data: messages = [] } = useQuery({
    queryKey: ["chat_messages", activeThreadId],
    enabled: !!activeThreadId && open,
    queryFn: async (): Promise<ChatRow[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at, kind, plan_id")
        .eq("thread_id", activeThreadId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      // Assistant replies are shown as plain text — strip any markdown
      // decoration (**bold**, # headings, - bullets) that older or new
      // replies may contain, so every thread reads the same way.
      return ((data ?? []) as ChatRow[]).map((m) =>
        m.role === "assistant" ? { ...m, content: toPlainText(m.content) } : m,
      );
    },

  });

  // ── 📞 Hands-free call (OpenAI Realtime, interruptible) ───────────────────
  // Everything spoken is mirrored into this thread as normal chat messages.
  const appendVoiceMessage = useCallback(
    async (role: "user" | "assistant", content: string) => {
      const threadId = activeThreadId;
      if (!threadId || !userId) return;
      const text = role === "assistant" ? toPlainText(content) : content.trim();
      if (!text) return;
      const { data: row, error } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, thread_id: threadId, role, content: text, kind: "text" })
        .select("id, role, content, created_at, kind, plan_id")
        .single();
      if (error || !row) return;
      qc.setQueryData<ChatRow[]>(["chat_messages", threadId], (cur) => [
        ...(cur ?? []),
        row as ChatRow,
      ]);
      void supabase
        .from("chat_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);
    },
    [activeThreadId, userId, qc],
  );

  const messagesRef = useRef<ChatRow[]>([]);
  messagesRef.current = messages;

  const voice = useRealtimeVoice({
    buildContext: useCallback(
      () =>
        messagesRef.current
          .slice(-10)
          .filter((m) => (m.content ?? "").trim())
          .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content)
          .join("\n"),
      [],
    ),
    onUserText: useCallback(
      (t: string) => void appendVoiceMessage("user", t),
      [appendVoiceMessage],
    ),
    onAssistantText: useCallback(
      (t: string) => void appendVoiceMessage("assistant", t),
      [appendVoiceMessage],
    ),
    onError: useCallback((m: string) => toast.error(m), []),
  });

  // Never keep a call running once the chat closes or the thread changes.
  useEffect(() => {
    if (!open) voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (voice.state !== "idle") voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Browser text-to-speech would fight the live voice — silence it while live.
  useEffect(() => {
    if (voice.live && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    }
  }, [voice.live]);



  // Focus textarea on open + thread switch.
  useEffect(() => {
    if (open && activeThreadId) {
      const t = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open, activeThreadId]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, [messages, isActiveBusy, open]);

  useEffect(() => {
    if (!open && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    }
  }, [open]);

  // Speak a message's text and mark it as the actively-spoken message so the
  // per-message Play/Stop button reflects state (and can stop it).
  const speakMessage = (id: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const clean = stripEmoji(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1;
    u.pitch = 1;
    u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
    u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
    setSpeakingId(id);
    window.speechSynthesis.speak(u);
  };

  // When a thread is opened (e.g. via a sentence's linked chat) and "Read
  // replies aloud" is on, read the latest assistant reply once.
  const autoSpokeThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      autoSpokeThreadRef.current = null;
      return;
    }
    if (!autoSpeak || !activeThreadId) return;
    if (autoSpokeThreadRef.current === activeThreadId) return;
    if (messages.length === 0) return;
    autoSpokeThreadRef.current = activeThreadId;
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.content?.trim());
    if (last) speakMessage(last.id, last.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoSpeak, activeThreadId, messages]);

  // Speak a short cue not tied to a specific message bubble.
  const speakCue = (text: string) => {
    setSpeakingId(null);
    speakPlain(text);
  };

  const toggleSpeak = (row: ChatRow) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speakingId === row.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    speakMessage(row.id, row.content);
  };

  const handleCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success("Copied");
    else toast.error("Failed to copy");
  };

  const updateThread = async (id: string, patch: Partial<Pick<Thread, "title" | "attached_document_ids" | "capabilities">>) => {
    qc.setQueryData<Thread[]>(["chat_threads", userId], (cur) =>
      (cur ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    const { error } = await supabase.from("chat_threads").update(patch).eq("id", id);
    if (error) toast.error("Couldn't save thread changes");
  };

  const setCap = (key: keyof ChatCapabilities, value: boolean) => {
    setPendingCaps((cur) => ({ ...cur, [key]: value }));
  };

  const setContextDocIds = (ids: string[]) => {
    if (!activeThreadId) return;
    void updateThread(activeThreadId, { attached_document_ids: ids });
  };

  const handleClear = async () => {
    if (!activeThreadId) return;
    const { error } = await supabase.from("chat_messages").delete().eq("thread_id", activeThreadId);
    if (error) {
      toast.error("Failed to clear chat");
      return;
    }
    // Detach the thread's plans too — a cleared chat starts from a genuinely
    // blank state, with no leftover plan memory feeding the next reply.
    await supabase.from("plans").update({ thread_id: null }).eq("thread_id", activeThreadId);
    qc.setQueryData(["chat_messages", activeThreadId], []);
    setClearConfirmOpen(false);
    toast.success("Chat cleared");
  };

  const handleDeleteThread = async () => {
    const id = deleteThreadId;
    if (!id || !userId) return;
    const { error } = await supabase.from("chat_threads").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete thread");
      return;
    }
    qc.setQueryData<Thread[]>(["chat_threads", userId], (cur) => (cur ?? []).filter((t) => t.id !== id));
    setDeleteThreadId(null);
    if (activeThreadId === id) {
      const remaining = (qc.getQueryData<Thread[]>(["chat_threads", userId]) ?? []).filter((t) => t.id !== id);
      if (remaining.length > 0) setActiveThreadId(remaining[0].id);
      else {
        const t = await createThread("Chat");
        setActiveThreadId(t?.id ?? null);
      }
    }
    toast.success("Thread deleted");
  };

  const submitRename = async () => {
    if (!renameThread) return;
    const title = renameValue.trim() || "Untitled";
    await updateThread(renameThread.id, { title });
    setRenameThread(null);
  };

  const handleNewThread = async () => {
    const t = await createThread("New chat");
    if (t) {
      setActiveThreadId(t.id);
      setDrawerOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  };

  /**
   * Send a message. `override` lets a programmatic caller (the Delegate
   * button) send its own text / capabilities / thread / attachments without
   * waiting for React state to settle.
   */
  const handleSend = async (override?: {
    text?: string;
    caps?: ChatCapabilities;
    threadId?: string;
    docIds?: string[];
  }) => {
    const text = (override?.text ?? input).trim();
    const threadId = override?.threadId ?? activeThreadId;
    if (!text || !userId || !threadId) return;
    if (busyThreadIds.has(threadId)) return;
    const capsUsed = override?.caps ?? caps;
    const docIdsUsed = override?.docIds ?? contextDocIds;
    if (capsUsed.image_analysis && pickedImages.some((a) => !a.url)) {
      toast.error("One of those images has no URL yet");
      return;
    }

    markBusy(threadId);
    if (!override?.text) setInput("");
    // Capability checkboxes are one-shot: this send uses `capsUsed` (captured
    // from this render) and the boxes immediately return to unchecked.
    setPendingCaps(NO_CAPS);


    const optimisticUser: ChatRow = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
      kind: "text",
      plan_id: null,
    };
    const prior = qc.getQueryData<ChatRow[]>(["chat_messages", threadId]) ?? [];
    qc.setQueryData(["chat_messages", threadId], [...prior, optimisticUser]);

    try {
      const { data: insertedUser, error: userErr } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, thread_id: threadId, role: "user", content: text, kind: "text" })
        .select("id, role, content, created_at, kind, plan_id")
        .single();
      if (userErr) throw userErr;

      // Keep plan cards in the history (as a short marker) so the model sees
      // WHERE in the conversation a plan ran. The concrete details of what the
      // plan produced come from server-side plan memory.
      const history = [...prior, insertedUser as ChatRow]
        .map((m) =>
          m.kind === "plan"
            ? { role: "assistant" as const, content: "[A plan was kicked off here and ran in the background.]" }
            : { role: m.role, content: m.content },
        )
        .filter((m) => (m.content ?? "").trim().length > 0);

      const result = await send({
        data: {
          messages: history,
          contextDocumentIds: docIdsUsed,
          imageUrls: capsUsed.image_analysis
            ? pickedImages.map((a) => a.url).filter((u): u is string => !!u)
            : [],
          threadId,
          capabilities: capsUsed,
        },
      });

      let insertedAssistant: ChatRow | null;
      if (result.route === "resumed") {
        // User's message became the answer to a paused plan; the plan itself
        // will post follow-ups. Don't insert a synthetic assistant bubble.
        insertedAssistant = null;
      } else if (result.route === "plan") {
        // Create + auto-run a plan tied to this thread.
        const allowedGroups = ACTION_TOOL_GROUPS.filter((g) => capsUsed[g]);
        const { data: planRow, error: planErr } = await supabase
          .from("plans")
          .insert({
            user_id: userId,
            status: "composing",
            user_request: text,
            attached_document_ids: docIdsUsed,
            thread_id: threadId,
          })

          .select("id")
          .single();
        if (planErr || !planRow) throw new Error(planErr?.message || "Couldn't start the plan");
        void supabase.functions.invoke("plan-compose", {
          body: { plan_id: planRow.id, allowed_tool_groups: allowedGroups },
        });
        const { data: msg, error: aErr } = await supabase
          .from("chat_messages")
          .insert({
            user_id: userId,
            thread_id: threadId,
            role: "assistant",
            content: "On it — planning and running this now.",
            kind: "plan",
            plan_id: planRow.id,
          })
          .select("id, role, content, created_at, kind, plan_id")
          .single();
        if (aErr) throw aErr;
        insertedAssistant = msg as ChatRow;
      } else {
        const { data: msg, error: aErr } = await supabase
          .from("chat_messages")
          .insert({
            user_id: userId,
            thread_id: threadId,
            role: "assistant",
            content: result.text ?? "",
            kind: "text",
          })
          .select("id, role, content, created_at, kind, plan_id")
          .single();
        if (aErr) throw aErr;
        insertedAssistant = msg as ChatRow;
      }

      qc.setQueryData<ChatRow[]>(["chat_messages", threadId], (cur) => {
        const base = (cur ?? []).filter((m) => m.id !== optimisticUser.id);
        const next = [...base, insertedUser as ChatRow];
        if (insertedAssistant) next.push(insertedAssistant);
        return next;
      });

      // Auto-read the reply aloud when enabled. Plans get a short cue; the
      // per-step cues are handled inside PlanProgressCard.
      if (autoSpeak && open && threadId === activeThreadId && insertedAssistant) {
        if (insertedAssistant.kind === "plan") {
          speakCue("Planning now.");
        } else if (insertedAssistant.content) {
          speakMessage(insertedAssistant.id, insertedAssistant.content);
        }
      }
      // bump thread ordering
      void supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

      // Auto-name the thread from the first message (background, non-blocking).
      const isFirstMessage = prior.filter((m) => m.role === "user").length === 0;
      const curTitle = (activeThread?.title ?? "").trim().toLowerCase();
      const isDefaultTitle = curTitle === "" || curTitle === "chat" || curTitle === "new chat";
      if (isFirstMessage && isDefaultTitle) {
        void (async () => {
          try {
            const { title } = await nameThread({ data: { message: text } });
            if (title) await updateThread(threadId, { title });
          } catch {
            /* naming is best-effort */
          }
        })();
      }
    } catch (err) {
      qc.invalidateQueries({ queryKey: ["chat_messages", threadId] });
      toast.error(err instanceof Error ? err.message : "Chat failed");
    } finally {
      markIdle(threadId);
      if (threadId === activeThreadId) {
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    }
  };

  // 🟣 Delegate (menu slot 15): fresh thread + attached doc + one automatic
  // send with the delegate capabilities. Runs exactly once per tap.
  useEffect(() => {
    if (!open || !delegate || !userId) return;
    if (delegateRef.current === delegate.id) return;
    delegateRef.current = delegate.id;
    (async () => {
      const t = await createThread(`Delegate: ${delegate.title}`.slice(0, 80));
      if (!t) return;
      setDrawerOpen(false);
      setActiveThreadId(t.id);
      setPendingCaps(delegate.capabilities);
      await updateThread(t.id, { attached_document_ids: [delegate.documentId] });
      await handleSend({
        text: delegate.prompt,
        caps: delegate.capabilities,
        threadId: t.id,
        docIds: [delegate.documentId],
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, delegate, userId]);

  const enabledCapCount = Object.values(caps).filter(Boolean).length;


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[88vh] max-h-[88vh] w-[96vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-col gap-1 border-b border-foreground/10 p-3">
            <div className="flex flex-row items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Threads"
                onClick={() => setDrawerOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <Button
                size="sm"
                variant={voice.state === "idle" ? "outline" : "destructive"}
                aria-label={voice.live ? "Stop hands-free mode" : "Start hands-free mode"}
                disabled={voice.connecting || !activeThreadId}
                onClick={() => (voice.state === "idle" ? void voice.start() : voice.stop())}
                className="gap-1.5"
              >
                {voice.connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : voice.live ? (
                  <PhoneOff className="h-4 w-4" />
                ) : (
                  <Phone className="h-4 w-4" />
                )}
                <span className="text-xs">
                  {voice.connecting ? "Connecting" : voice.live ? "End call" : "Hands-free"}
                </span>
              </Button>
            </div>

            <div className="mr-8 flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Clear chat"
                className="text-destructive hover:text-destructive"
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Chat settings">
                    <SettingsIcon className="h-5 w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">Use for this message</p>
                        <p className="text-[11px] leading-tight text-muted-foreground">
                          Nothing checked = plain text reply. Boxes clear after each send.
                        </p>
                      </div>
                      {enabledCapCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setPendingCaps(NO_CAPS)}
                          className="shrink-0 text-[11px] text-muted-foreground underline hover:text-foreground"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {CAP_LABELS.map(({ key, label, hint }) => (
                      <div key={key} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Label htmlFor={`cap-${key}`} className="text-sm">{label}</Label>
                          <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
                        </div>
                        <Checkbox
                          id={`cap-${key}`}
                          className="mt-0.5"
                          checked={caps[key]}
                          onCheckedChange={(v) => setCap(key, v === true)}
                        />
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between gap-3 border-t border-foreground/10 pt-3">
                      <div className="min-w-0">
                        <Label htmlFor="cap-autospeak" className="text-sm">Read replies aloud</Label>
                        <p className="text-[11px] leading-tight text-muted-foreground">Automatically speak Orby's answers</p>
                      </div>
                      <Switch
                        id="cap-autospeak"
                        checked={autoSpeak}
                        onCheckedChange={setAutoSpeakPref}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setSettingsOpen(false);
                        setImagePickerOpen(true);
                      }}
                    >
                      <ImageIcon className="mr-2 h-4 w-4" /> Attach images
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setSettingsOpen(false);
                        setDocPickerOpen(true);
                      }}
                    >
                      <Paperclip className="mr-2 h-4 w-4" /> Attach documents
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            </div>
            <DialogTitle className="px-1 text-base font-medium leading-snug break-words">
              {activeThread?.title ?? "Chat"}
            </DialogTitle>
            {voice.live && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Hands-free is live — just talk, and talk over Orby to interrupt. Planning and
                document editing are paused until you end the call.
              </p>
            )}
          </DialogHeader>


          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 && !isActiveBusy ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                <MessagesSquare className="mb-1 h-6 w-6 opacity-50" />
                Ask Orby anything — chat, search, edit your docs, or make images & videos.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((m) =>
                  m.kind === "plan" && m.plan_id ? (
                    <div key={m.id} className="flex flex-col items-start">
                      <PlanProgressCard planId={m.plan_id} autoSpeak={autoSpeak && open} />
                    </div>
                  ) : (
                    <div
                      key={m.id}
                      className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}
                    >
                      <div
                        className={
                          m.role === "user"
                            ? "max-w-[85%] rounded-2xl bg-chat-user px-3.5 py-2 text-base text-chat-user-foreground"
                            : "max-w-[90%] rounded-2xl bg-chat-assistant px-3.5 py-2 text-base text-chat-assistant-foreground"
                        }
                      >
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSpeak(m)}
                          aria-label={speakingId === m.id ? "Stop reading" : "Read aloud"}
                          className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
                        >
                          {speakingId === m.id ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopy(m.content)}
                          aria-label="Copy"
                          className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {m.role === "assistant" && (
                          <button
                            type="button"
                            onClick={() => setInsertFor(m)}
                            aria-label="Insert into document"
                            className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
                          >
                            <FileDown className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ),
                )}
                {isActiveBusy && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-foreground/40" />
                    Thinking…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-foreground/10 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDocPickerOpen(true)}
              >
                <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                {contextDocIds.length > 0 ? `${contextDocIds.length} attached` : "Attach documents"}
              </Button>
              {contextDocIds.map((id) => {
                const d = documents.find((x) => x.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-2.5 py-1 text-xs"
                  >
                    <button
                      type="button"
                      aria-label={`Open "${d?.title ?? "Document"}"`}
                      onClick={() => {
                        onOpenChange(false);
                        onOpenDocument?.(id);
                      }}
                      className="max-w-[140px] truncate hover:underline"
                    >
                      {d?.title ?? "Document"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextDocIds(contextDocIds.filter((x) => x !== id));
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {pickedImages.map((img) => (
                <span
                  key={img.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-2.5 py-1 text-xs"
                >
                  <ImageIcon className="h-3 w-3" />
                  <span className="max-w-[120px] truncate">{img.title || "Image"}</span>
                  <button
                    type="button"
                    onClick={() => setPickedImages((prev) => prev.filter((x) => x.id !== img.id))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {pickedImages.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPickedImages([])}
                  className="shrink-0 rounded-full border border-foreground/15 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear images
                </button>
              )}
            </div>

            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <SettingsIcon className="h-3 w-3" />
              {enabledCapCount === 0
                ? "Text reply"
                : CAP_LABELS.filter(({ key }) => caps[key])
                    .map(({ label }) => label)
                    .join(" · ")}
            </div>

            <div className="flex items-end gap-2">
              <Button
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => void dictation.toggle()}
                disabled={dictation.transcribing}
                aria-label={dictation.recording ? "Stop recording" : "Start voice input"}
                title={dictation.recording ? "Stop and transcribe" : "Voice input"}
                className="shrink-0 text-lg"
              >
                {dictation.transcribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : dictation.recording ? (
                  <span aria-hidden>⬛️</span>
                ) : (
                  <span aria-hidden>🔴</span>
                )}
              </Button>
              <Textarea

                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Message Orby…"
                rows={1}
                className="max-h-40 min-h-[44px] flex-1 resize-none"
              />
              <Button
                size="icon"
                onClick={() => void handleSend()}
                disabled={isActiveBusy || !input.trim()}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Back button — matches the grid menu's bottom back button */}
          <div className="border-t border-foreground/10 p-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close chat"
              className="flex w-full items-center justify-center rounded-2xl border border-foreground/10 bg-card/60 py-3 text-foreground/80 transition hover:bg-card hover:text-foreground"
            >
              <span className="text-lg">←</span>
            </button>
          </div>

          {/* Threads list — fills the whole chat panel */}
          {drawerOpen && (
            <div className="absolute inset-0 z-20 flex flex-col bg-background">
              <div className="flex items-center justify-between gap-2 border-b border-foreground/10 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Close chats"
                    onClick={() => setDrawerOpen(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                  <span className="text-base font-medium">Chats</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => void handleNewThread()}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> New
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {threads.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No chats yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {threads.map((t) => (
                      <li
                        key={t.id}
                        className={`flex items-center gap-2 rounded-lg px-2 ${
                          t.id === activeThreadId ? "bg-foreground/10" : "hover:bg-foreground/5"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveThreadId(t.id);
                            setDrawerOpen(false);
                          }}
                          className="min-w-0 flex-1 truncate px-1 py-3.5 text-left text-base"
                        >
                          {t.title || "Untitled"}
                        </button>
                        <button
                          type="button"
                          aria-label="Rename"
                          onClick={() => {
                            setRenameThread(t);
                            setRenameValue(t.title);
                          }}
                          className="shrink-0 rounded p-2 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete thread"
                          onClick={() => setDeleteThreadId(t.id)}
                          className="shrink-0 rounded p-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. All messages in this thread will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleClear();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteThreadId} onOpenChange={(o) => { if (!o) setDeleteThreadId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the thread and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteThread();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!renameThread} onOpenChange={(o) => { if (!o) setRenameThread(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename thread</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitRename();
              }
            }}
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenameThread(null)}>Cancel</Button>
            <Button onClick={() => void submitRename()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentPickerSheet
        open={docPickerOpen}
        onOpenChange={setDocPickerOpen}
        initialSelectedIds={contextDocIds}
        onConfirm={setContextDocIds}
      />

      <MediaGalleryPicker
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        kind="image"
        mode="multiple"
        maxSelected={6}
        initialSelectedIds={pickedImages.map((a) => a.id)}
        onConfirm={(assets) => {
          const picked = assets.slice(0, 6);
          setPickedImages(picked);
          // Attaching images implies image analysis for the next message.
          if (picked.length) setCap("image_analysis", true);
        }}
      />

      <InsertIntoDocDialog
        row={insertFor}
        onClose={() => setInsertFor(null)}
        currentDocumentId={currentDocumentId}
        documents={documents}
      />
    </>
  );
}

type PlanStep = {
  description?: string;
  status?: string;
  io?: any;
};

type PlanRow = {
  id: string;
  status: string;
  plan_summary: string | null;
  result_summary: string | null;
  error_message: string | null;
  current_step: number;
  total_steps: number;
  steps: PlanStep[] | null;
};

const PLAN_DONE = new Set(["completed", "failed", "cancelled", "proposed"]);

function PlanProgressCard({ planId, autoSpeak = false }: { planId: string; autoSpeak?: boolean }) {
  const announcedRef = useRef(false);
  const qc = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const { data: plan } = useQuery({
    queryKey: ["chat_plan", planId],
    refetchInterval: (q) => {
      const s = (q.state.data as PlanRow | undefined)?.status;
      return s && PLAN_DONE.has(s) ? false : 2000;
    },
    queryFn: async (): Promise<PlanRow | null> => {
      const { data } = await supabase
        .from("plans")
        .select("id, status, plan_summary, result_summary, error_message, current_step, total_steps, steps")
        .eq("id", planId)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  // Announce the plan's action once, when it starts running (after composing).
  useEffect(() => {
    if (!autoSpeak || announcedRef.current || !plan) return;
    if (plan.status === "composing" || plan.status === "proposed" || PLAN_DONE.has(plan.status)) return;
    announcedRef.current = true;
    speakPlain(planActionCue(plan));
  }, [autoSpeak, plan]);


  const stopPlan = async () => {
    setStopping(true);
    const { error } = await supabase.from("plans").update({ status: "cancelled" }).eq("id", planId);
    if (error) {
      setStopping(false);
      toast.error(`Couldn't stop: ${error.message}`);
      return;
    }
    qc.setQueryData<PlanRow | null>(["chat_plan", planId], (cur) =>
      cur ? { ...cur, status: "cancelled" } : cur,
    );
    toast.success("Plan stopped");
  };


  if (!plan) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
      </div>
    );
  }

  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const running = !PLAN_DONE.has(plan.status);
  const headerLabel =
    plan.status === "composing"
      ? "Planning…"
      : plan.status === "completed"
        ? "Done"
        : plan.status === "failed"
          ? "Something went wrong"
          : plan.status === "cancelled"
            ? "Stopped"
            : plan.status === "proposed"
              ? "Needs your review"
              : `Working… ${plan.current_step}/${plan.total_steps}`;

  return (
    <div className="w-full max-w-[95%] rounded-xl border border-border bg-card/50 p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-2 font-medium">
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : plan.status === "completed" ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="flex-1">{headerLabel}</span>
        {running && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-destructive/40 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={stopping}
            onClick={() => void stopPlan()}
          >
            <Square className="h-3 w-3" /> Stop
          </Button>
        )}
      </div>

      {plan.plan_summary && (
        <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">{plan.plan_summary}</p>
      )}
      {steps.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {steps.map((s, i) => {
            const done = s.status === "done" || s.status === "completed" || s.status === "succeeded";
            const failed = s.status === "failed" || s.status === "error";
            const active = i === plan.current_step && running && !done && !failed;
            return (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : failed ? (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs leading-snug">{s.description ?? `Step ${i + 1}`}</div>
                  {active && <StepReasoning io={s.io} />}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {plan.status === "completed" && plan.result_summary && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-foreground/80">{plan.result_summary}</p>
      )}
      {plan.status === "failed" && plan.error_message && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-destructive">{plan.error_message}</p>
      )}
    </div>
  );
}

const INSERT_EMOJI_FILTERS = ["⚪️", "⚫️", "🟣", "🔵", "🔴", "🟢", "🟡", "🟠", "🟤"];

type SendStage = "doc" | "where" | "pickAnchor";

function InsertIntoDocDialog({
  row,
  onClose,
  currentDocumentId,
  documents,
}: {
  row: ChatRow | null;
  onClose: () => void;
  currentDocumentId: string | null;
  documents: { id: string; title: string }[];
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<SendStage>("doc");
  const [docId, setDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetSentences, setTargetSentences] = useState<{ id: string; content: string }[]>([]);
  const [anchorIdx, setAnchorIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (row) {
      setStage("doc");
      setDocId(null);
      setSearchQuery("");
      setTargetSentences([]);
      setAnchorIdx(0);
    }
  }, [row]);

  const pickDoc = async (id: string) => {
    setDocId(id);
    setAnchorIdx(0);
    const { data } = await supabase
      .from("sentences")
      .select("id, content")
      .eq("document_id", id)
      .order("order_index", { ascending: true });
    setTargetSentences(data ?? []);
    setStage("where");
  };

  const doInsert = async (
    targetId: string,
    where: "top" | "bottom" | "current" | "afterAnchor",
    idx = 0,
  ) => {
    if (!row) return;
    const sentences = splitIntoSentences(row.content);
    if (sentences.length === 0) {
      toast.error("Nothing to insert");
      return;
    }
    setBusy(true);
    try {
      let insertAt = 0;
      if (where === "top") {
        insertAt = 0;
      } else if (where === "bottom") {
        insertAt = targetSentences.length;
      } else if (where === "afterAnchor") {
        insertAt = idx + 1;
      } else {
        const { data: doc } = await supabase
          .from("documents")
          .select("current_sentence_index")
          .eq("id", targetId)
          .single();
        const cur = typeof doc?.current_sentence_index === "number" ? doc.current_sentence_index : -1;
        insertAt = cur + 1;
      }
      const { error } = await supabase.rpc("insert_sentences_at", {
        p_document_id: targetId,
        p_contents: sentences,
        p_insert_at: insertAt,
      });
      if (error) throw error;
      toast.success(`Inserted ${sentences.length} sentence${sentences.length === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["sentences", targetId] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Insert failed");
    } finally {
      setBusy(false);
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const sorted = sortDocsByTitle(documents ?? []);
  const filtered = q ? sorted.filter((d) => (d.title || "").toLowerCase().includes(q)) : sorted;

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-md flex-col gap-0 rounded-3xl border border-foreground/10 bg-card/95 p-4 backdrop-blur">
        <DialogHeader className="mb-3 flex-row items-center justify-between space-y-0 px-2">
          <DialogTitle className="font-display text-lg">
            {stage === "doc" && "Send to which list?"}
            {stage === "where" && "Where in the list?"}
            {stage === "pickAnchor" && "After which sentence?"}
          </DialogTitle>
        </DialogHeader>

        {stage === "doc" && (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {INSERT_EMOJI_FILTERS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setSearchQuery(emoji)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-foreground/10 bg-foreground/5 text-lg transition hover:bg-foreground/10 active:scale-[0.95]"
                  aria-label={`Filter by ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <Input
              placeholder="Search lists…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="shrink-0"
            />
            <div className="flex flex-col gap-1.5 overflow-y-auto p-1">
              {filtered.length > 0 ? (
                filtered.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => void pickDoc(d.id)}
                    className={
                      "w-full shrink-0 rounded-xl border px-3 py-2.5 text-left text-sm transition active:scale-[0.98] " +
                      (d.id === currentDocumentId
                        ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                        : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10")
                    }
                  >
                    {d.title || "Untitled"}
                  </button>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {q ? "No matching lists." : "No documents yet."}
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "where" && docId && (
          <div className="flex flex-col gap-2 p-1">
            <button
              disabled={busy}
              onClick={() => void doInsert(docId, "top")}
              className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10 disabled:opacity-40"
            >
              ⤒  Top of list
            </button>
            <button
              disabled={busy || targetSentences.length === 0}
              onClick={() => void doInsert(docId, "current")}
              className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10 disabled:opacity-40"
            >
              ●  After current sentence
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (targetSentences.length === 0) void doInsert(docId, "top");
                else setStage("pickAnchor");
              }}
              className="w-full rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-sm text-primary transition active:scale-[0.98] hover:bg-primary/20 disabled:opacity-40"
            >
              ⋯  After a specific sentence…
            </button>
            <button
              disabled={busy}
              onClick={() => void doInsert(docId, "bottom")}
              className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-sm transition active:scale-[0.98] hover:bg-foreground/10 disabled:opacity-40"
            >
              ⤓  Bottom of list
            </button>
            <button
              onClick={() => { setDocId(null); setStage("doc"); setTargetSentences([]); }}
              className="mt-1 w-full rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Pick a different list
            </button>
          </div>
        )}

        {stage === "pickAnchor" && docId && (
          <div className="flex min-h-0 flex-col gap-2 p-1">
            <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto rounded-xl border border-foreground/10 bg-foreground/5 p-1">
              {targetSentences.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setAnchorIdx(i)}
                  className={
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition " +
                    (i === anchorIdx
                      ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                      : "hover:bg-foreground/10")
                  }
                >
                  <span className="mr-2 text-xs opacity-60">{i + 1}.</span>
                  {s.content}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStage("where")}
                className="flex-1 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
              <button
                disabled={busy}
                onClick={() => void doInsert(docId, "afterAnchor", anchorIdx)}
                className="flex-[2] rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm text-primary transition active:scale-[0.98] hover:bg-primary/20 disabled:opacity-40"
              >
                {busy ? "Inserting…" : `Insert after sentence ${anchorIdx + 1}`}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
