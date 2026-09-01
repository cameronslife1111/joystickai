import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  Paperclip,
  X,
  Play,
  Square,
  Copy,
  FileDown,
  FilePlus,
  Send,
  Trash2,
  Image as ImageIcon,
  Type,
  Plus,
  Pencil,
  MessagesSquare,
  Menu,
  Search,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Phone,
  PhoneOff,
  Clock,
  Pause,
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
import { speakText, cancelSpeech, isSpeechEnabled } from "@/lib/speech";

import { useVoiceDictation, appendTranscript } from "@/lib/use-voice-dictation";
import { useHandsFree } from "@/lib/hands-free";

import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { useAutoAttachDocs } from "@/lib/use-auto-attach-docs";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { sortDocsByTitle } from "@/lib/sortDocs";
import { toPlainText } from "@/lib/plain-text";

import { StepReasoning } from "./plan/StepReasoning";
import { PlanReviewCard, PlanSteerBox } from "./PlanReviewCard";
import { ChatMediaRow, quotedTitles } from "./ChatMedia";
import { extractArtifacts } from "@/lib/plan-memory";
import { analyzeDelegateStep } from "@/lib/delegate.functions";
import { buildDelegatePlanPrompt } from "@/lib/delegate-prompt";

import { ScheduleEditorDialog } from "./plan/ScheduleEditorDialog";
import { listSchedules, deleteSchedule, toggleSchedule } from "@/lib/plan-schedules.functions";

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
   * attached, ask Orby for 5 suggested tasks and show them as checkboxes.
   * `id` is a nonce so each tap fires exactly once.
   */
  delegate?: {
    id: string;
    documentId: string;
    title: string;
    index: number;
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
  /** Sticky per chat: run plans made here without asking for approval. */
  auto_approve_plans: boolean;
  updated_at: string;
  last_assistant_at: string | null;
  last_read_at: string | null;
};

/** Columns every thread read needs — keeps the selects in sync. */
const THREAD_COLS =
  "id, title, attached_document_ids, capabilities, auto_approve_plans, updated_at, last_assistant_at, last_read_at";

/** A chat is unread when AI activity is newer than the last time it was read. */
function isUnread(t: Thread): boolean {
  if (!t.last_assistant_at) return false;
  if (!t.last_read_at) return true;
  return t.last_assistant_at > t.last_read_at;
}

/** Unread chats first (newest AI activity on top), then most-recently-used. */
function sortThreads(list: Thread[]): Thread[] {
  return [...list].sort((a, b) => {
    const ua = isUnread(a);
    const ub = isUnread(b);
    if (ua !== ub) return ua ? -1 : 1;
    const ka = ua ? (a.last_assistant_at ?? a.updated_at) : a.updated_at;
    const kb = ub ? (b.last_assistant_at ?? b.updated_at) : b.updated_at;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
}

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
  speakText(text);
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
  return { ...NO_CAPS, ...(raw && typeof raw === "object" ? raw : {}) };
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
  const listSchedulesFn = useServerFn(listSchedules);
  const deleteScheduleFn = useServerFn(deleteSchedule);
  const toggleScheduleFn = useServerFn(toggleSchedule);

  const [userId, setUserId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  /** Sticky capability checkboxes — saved per thread until the user unchecks. */
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
  /** Chats list → 📎 Auto-attach: default documents for every new chat. */
  const [autoAttachOpen, setAutoAttachOpen] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [titlePickerOpen, setTitlePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Composer clock button → schedule this message for later. */
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [insertFor, setInsertFor] = useState<ChatRow | null>(null);
  const [newDocFor, setNewDocFor] = useState<ChatRow | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteThreadId, setDeleteThreadId] = useState<string | null>(null);
  const [renameThread, setRenameThread] = useState<Thread | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Last known cursor position in the composer (survives sheets opening). */
  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The messages wrapper — watched so late-growing content re-pins the view. */
  const messagesListRef = useRef<HTMLDivElement>(null);
  const bootstrappedRef = useRef(false);
  /** Nonce of the last 🟣 Delegate request we already kicked off. */
  const delegateRef = useRef<string | null>(null);
  /** True while 🟣 Delegate is analysing the step, before the plan appears. */
  const [delegateAnalyzing, setDelegateAnalyzing] = useState(false);
  const analyzeStep = useServerFn(analyzeDelegateStep);




  // 🔴 / ⬛️ voice dictation — appends the transcript to the message box.
  const dictation = useVoiceDictation(
    useCallback((text: string) => {
      setInput((prev) => appendTranscript(prev, text));
      setTimeout(() => textareaRef.current?.focus(), 50);
    }, []),
  );

  /** "Attach Image titles" — type the picked titles into the composer at the cursor. */
  const insertTitlesAtCursor = useCallback((assets: MediaAsset[]) => {
    const titles = assets
      .map((a) => a.title.replace(/["“”]/g, "").trim())
      .filter(Boolean);
    if (!titles.length) return;
    const insert = titles.map((t) => `"${t}"`).join(", ");
    setInput((prev) => {
      const pos = Math.min(Math.max(cursorRef.current, 0), prev.length);
      // Pad with spaces so the titles don't fuse with neighboring words.
      let text = insert;
      if (pos > 0 && !/\s/.test(prev[pos - 1])) text = " " + text;
      if (pos < prev.length && !/\s/.test(prev[pos])) text = text + " ";
      const next = prev.slice(0, pos) + text + prev.slice(pos);
      const newCursor = pos + text.length;
      cursorRef.current = newCursor;
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(newCursor, newCursor);
        }
      }, 50);
      return next;
    });
  }, []);


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
    if (!next) {
      cancelSpeech();
      setSpeakingId(null);
    }
  };

  const { data: threads = [], isFetched: threadsFetched } = useQuery({
    queryKey: ["chat_threads", userId],
    enabled: !!userId && open,
    // Keeps the inbox live while the chat is open: replies written by scheduled
    // messages and background plans show up on their own.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Thread[]> => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select(
          THREAD_COLS,
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return sortThreads(
        (data ?? []).map((t: any) => ({
          id: t.id,
          title: t.title,
          attached_document_ids: t.attached_document_ids ?? [],
          capabilities: normalizeCaps(t.capabilities),
          auto_approve_plans: !!t.auto_approve_plans,
          updated_at: t.updated_at,
          last_assistant_at: t.last_assistant_at ?? null,
          last_read_at: t.last_read_at ?? null,
        })),
      );
    },
  });

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );
  const filteredThreads = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => (t.title || "Untitled").toLowerCase().includes(q));
  }, [threads, threadSearch]);
  const caps = pendingCaps;
  const contextDocIds = activeThread?.attached_document_ids ?? [];

  // Scheduled messages waiting to be sent in this chat.
  const { data: scheduleData, refetch: refetchSchedules } = useQuery({
    queryKey: ["chat_schedules", activeThreadId],
    enabled: open && !!activeThreadId,
    refetchInterval: 30_000,
    queryFn: async () => await listSchedulesFn({}),
  });
  const threadSchedules = useMemo(
    () =>
      (scheduleData?.schedules ?? []).filter(
        (s: any) => s.thread_id && s.thread_id === activeThreadId,
      ),
    [scheduleData, activeThreadId],
  );
  const isActiveBusy = activeThreadId ? busyThreadIds.has(activeThreadId) : false;

  const unreadCount = useMemo(() => threads.filter(isUnread).length, [threads]);

  /**
   * Mark a thread as just-used: persist a fresh `updated_at` and immediately
   * re-sort the cached thread list so the chat jumps to the top of the list
   * without waiting for a reload.
   */
  const bumpThread = useCallback(
    (id: string, opts?: { assistant?: boolean; read?: boolean }) => {
      if (!id) return;
      const now = new Date().toISOString();
      const patch: {
        updated_at: string;
        last_assistant_at?: string;
        last_read_at?: string;
      } = { updated_at: now };
      if (opts?.assistant) patch.last_assistant_at = now;
      if (opts?.read !== false) patch.last_read_at = now;
      qc.setQueryData<Thread[]>(["chat_threads", userId], (cur) =>
        sortThreads((cur ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t))),
      );
      void supabase
        .from("chat_threads")
        .update(patch)
        .eq("id", id)
        .then(() => {
          qc.invalidateQueries({ queryKey: ["chat_threads", userId] });
          qc.invalidateQueries({ queryKey: ["chat_unread"] });
        });
    },
    [qc, userId],
  );

  /** Clear the unread dot for a chat the user is now looking at. */
  const markThreadRead = useCallback(
    (id: string) => {
      if (!id) return;
      const now = new Date().toISOString();
      const cached = qc.getQueryData<Thread[]>(["chat_threads", userId]) ?? [];
      const t = cached.find((x) => x.id === id);
      if (t && !isUnread(t)) return; // already read — no write needed
      qc.setQueryData<Thread[]>(["chat_threads", userId], (cur) =>
        sortThreads((cur ?? []).map((x) => (x.id === id ? { ...x, last_read_at: now } : x))),
      );
      void supabase
        .from("chat_threads")
        .update({ last_read_at: now })
        .eq("id", id)
        .then(() => {
          qc.invalidateQueries({ queryKey: ["chat_unread"] });
        });
    },
    [qc, userId],
  );

  // Viewing a thread clears its unread state — including replies that arrive
  // from the background while the thread is on screen.
  useEffect(() => {
    if (!open || drawerOpen || !activeThreadId) return;
    markThreadRead(activeThreadId);
  }, [open, drawerOpen, activeThreadId, threads, markThreadRead]);

  const { ids: autoAttachIds, save: saveAutoAttach } = useAutoAttachDocs(userId ?? null);

  const createThread = async (title = "New chat"): Promise<Thread | null> => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from("chat_threads")
      .insert({
        user_id: userId,
        title,
        capabilities: NO_CAPS,
        attached_document_ids: autoAttachIds,
      })
      .select(THREAD_COLS)
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
      auto_approve_plans: !!(data as any).auto_approve_plans,
      updated_at: data.updated_at,
      last_assistant_at: (data as any).last_assistant_at ?? null,
      last_read_at: (data as any).last_read_at ?? null,
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
    // 🟣 Delegate owns the bootstrap for this session: it creates and selects
    // its own fresh thread. Mark bootstrap done so the "restore last chat"
    // pass can never flip us back to an older Delegate thread.
    if (delegate) {
      bootstrappedRef.current = true;
      setDrawerOpen(false);
      return;
    }
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

  // Reset chat search when the threads drawer closes so it opens fresh next time.
  useEffect(() => {
    if (!drawerOpen) setThreadSearch("");
  }, [drawerOpen]);

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

  // Capability checkboxes are sticky per thread: load whatever this chat has
  // saved, and keep it until the user unchecks it.
  useEffect(() => {
    setPendingCaps(activeThread?.capabilities ?? NO_CAPS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, activeThread?.capabilities]);

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
  const messagesRef = useRef<ChatRow[]>([]);
  messagesRef.current = messages;

  // The call lives above this dialog (see HandsFreeProvider) so it keeps
  // running while the user moves around the rest of the app.
  const call = useHandsFree();
  const voice = useMemo(
    () => ({
      state: call.threadId && call.threadId !== activeThreadId ? ("idle" as const) : call.state,
      live: call.live && call.threadId === activeThreadId,
      connecting: call.connecting && call.threadId === activeThreadId,
      stop: call.stop,
      start: () =>
        activeThreadId
          ? call.start(
              activeThreadId,
              messagesRef.current
                .slice(-10)
                .filter((m) => (m.content ?? "").trim())
                .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content)
                .join("\n"),
            )
          : Promise.resolve(),
    }),
    [call, activeThreadId],
  );

  // A call belongs to one thread — switching conversations ends it.
  useEffect(() => {
    if (call.threadId && activeThreadId && call.threadId !== activeThreadId) call.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Read-aloud would fight the live voice — silence it while live.
  useEffect(() => {
    if (voice.live) {
      cancelSpeech();
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

  /** Jump to the very bottom of the message list. */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /** True when the user is already parked at (or very near) the bottom. */
  const atBottom = useCallback((slack = 120) => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
  }, []);

  // Opening a chat (or switching threads) must land at the bottom. Plan cards,
  // media thumbnails and long replies get their real height after the first
  // paint, so re-pin over a short settle window instead of scrolling once.
  useEffect(() => {
    if (!open || !activeThreadId) return;
    const timers = [0, 60, 150, 300, 600, 1000, 1600].map((ms) =>
      window.setTimeout(() => scrollToBottom("auto"), ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open, activeThreadId, messages.length, scrollToBottom]);

  // New messages / live plan updates keep the smooth follow, but never yank the
  // view down when the user has scrolled up to read.
  useEffect(() => {
    if (!open) return;
    if (!atBottom(240)) return;
    requestAnimationFrame(() => scrollToBottom("smooth"));
  }, [messages, isActiveBusy, open, atBottom, scrollToBottom]);

  // Content that grows after layout (images loading, a plan card expanding or
  // finishing) re-pins the view when the user is already at the bottom.
  useEffect(() => {
    if (!open) return;
    const list = messagesListRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom()) scrollToBottom("auto");
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [open, activeThreadId, messages.length, atBottom, scrollToBottom]);

  useEffect(() => {
    if (!open) {
      cancelSpeech();
      setSpeakingId(null);
    }
  }, [open]);

  // Speak a message's text and mark it as the actively-spoken message so the
  // per-message Play/Stop button reflects state (and can stop it).
  const speakMessage = (id: string, text: string) => {
    const clear = () => setSpeakingId((cur) => (cur === id ? null : cur));
    setSpeakingId(id);
    const ok = speakText(text, { onEnd: clear, onError: clear });
    if (!ok) clear();
  };

  // When a thread is opened (e.g. via a sentence's linked chat) and "Read
  // replies aloud" is on, read the latest assistant reply once.
  const autoSpokeThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      autoSpokeThreadRef.current = null;
      return;
    }
    if (!autoSpeak || !activeThreadId || voice.live) return;
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
    if (speakingId === row.id) {
      cancelSpeech();
      setSpeakingId(null);
      return;
    }
    // Sound is off app-wide — the engine would block the request anyway, so
    // tell the user why pressing Play does nothing.
    if (!isSpeechEnabled()) {
      toast.info("Turn on Sound to hear messages");
      return;
    }
    speakMessage(row.id, row.content);
  };

  const handleCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success("Copied");
    else toast.error("Failed to copy");
  };

  const updateThread = async (id: string, patch: Partial<Pick<Thread, "title" | "attached_document_ids" | "capabilities" | "auto_approve_plans">>) => {
    qc.setQueryData<Thread[]>(["chat_threads", userId], (cur) =>
      (cur ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    const { error } = await supabase.from("chat_threads").update(patch).eq("id", id);
    if (error) toast.error("Couldn't save thread changes");
  };

  const setCap = (key: keyof ChatCapabilities, value: boolean) => {
    setPendingCaps((cur) => {
      const next = { ...cur, [key]: value };
      if (activeThreadId) void updateThread(activeThreadId, { capabilities: next });
      return next;
    });
  };

  /**
   * "Auto approve plans" — sticky per chat. When on, plans created in this chat
   * start as soon as they're written instead of waiting on the review card.
   */
  const autoApprovePlans = !!activeThread?.auto_approve_plans;
  const setAutoApprovePlans = (value: boolean) => {
    if (!activeThreadId) return;
    void updateThread(activeThreadId, { auto_approve_plans: value });
  };

  /** Clear all — unchecks every capability for this chat and persists it. */
  const clearCaps = () => {
    setPendingCaps(NO_CAPS);
    if (activeThreadId) void updateThread(activeThreadId, { capabilities: { ...NO_CAPS } });
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
    /** Delegate only: let Orby pick its own capabilities for this send. */
    auto?: boolean;
    threadId?: string;
    docIds?: string[];
  }): Promise<boolean> => {
    const text = (override?.text ?? input).trim();
    const threadId = override?.threadId ?? activeThreadId;
    if (!text || !userId || !threadId) return false;
    if (busyThreadIds.has(threadId)) return false;
    // While a hands-free call is live this is a text-only conversation.
    const capsUsed = voice.live ? NO_CAPS : (override?.caps ?? caps);
    const docIdsUsed = override?.docIds ?? contextDocIds;
    if (capsUsed.image_analysis && pickedImages.some((a) => !a.url)) {
      toast.error("One of those images has no URL yet");
      return false;
    }


    markBusy(threadId);
    if (!override?.text) setInput("");
    // Capability checkboxes are sticky — they stay on until the user unchecks.



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
          autoCapabilities: override?.auto === true,
        },
      });

      let insertedAssistant: ChatRow | null;
      if (result.route === "resumed") {
        // User's message became the answer to a paused plan; the plan itself
        // will post follow-ups. Don't insert a synthetic assistant bubble.
        insertedAssistant = null;
      } else if (result.route === "plan") {
        // Per-chat "Auto approve plans": read from the live cache so a
        // programmatic send picks up the current setting.
        const autoApproveForThread = !!(
          qc.getQueryData<Thread[]>(["chat_threads", userId]) ?? []
        ).find((t) => t.id === threadId)?.auto_approve_plans;
        // Create + auto-run a plan tied to this thread.
        // Orby decides the capabilities itself; anything the user ticked is
        // kept on top of that. The plan waits for review in this chat.
        const decided = (result.capabilities ?? capsUsed) as ChatCapabilities;
        const mergedCaps = { ...decided } as ChatCapabilities;
        for (const g of ACTION_TOOL_GROUPS) if (capsUsed[g]) mergedCaps[g] = true;
        // "Planning" alone still needs somewhere to put the work — document
        // tools are the baseline so the planner is never left with no tools.
        if (!ACTION_TOOL_GROUPS.some((g) => mergedCaps[g])) mergedCaps.document_editing = true;
        const allowedGroups = ACTION_TOOL_GROUPS.filter((g) => mergedCaps[g]);
        const { data: planRow, error: planErr } = await supabase
          .from("plans")
          .insert({
            user_id: userId,
            status: "composing",
            user_request: text,
            attached_document_ids: docIdsUsed,
            thread_id: threadId,
            review_in_chat: true,
            proposed_capabilities: mergedCaps as any,
            // "Auto approve plans" is on for this chat → plan-compose approves
            // and starts it as soon as the steps are written.
            auto_approve_after_compose: autoApproveForThread,
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
            content: autoApproveForThread
              ? "On it — writing a plan and starting it."
              : "On it — writing a plan for you to review.",
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
          speakCue("Writing a plan for you to review.");
        } else if (insertedAssistant.content) {
          speakMessage(insertedAssistant.id, insertedAssistant.content);
        }
      }
      // bump thread ordering; the reply counts as read only when the user is
      // actually looking at this thread.
      bumpThread(threadId, {
        assistant: !!insertedAssistant,
        read: open && threadId === activeThreadId,
      });

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
      return true;
    } catch (err) {
      qc.invalidateQueries({ queryKey: ["chat_messages", threadId] });
      toast.error(err instanceof Error ? err.message : "Chat failed");
      return false;
    } finally {
      markIdle(threadId);
      if (threadId === activeThreadId) {
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    }
  };

  /**
   * Always points at the current render's `handleSend`. Programmatic callers
   * (🟣 Delegate) must go through this — a captured closure would still be
   * holding the first render's state (no user id yet) and silently no-op.
   */
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // 🟣 Delegate (menu slot 15 / purple orb hold): fresh thread + attached doc,
  // Orby analyses the step and proposes one plan for review. Once per tap.
  const runDelegate = useCallback(
    async (threadId: string, documentId: string, index: number) => {
      setDelegateAnalyzing(true);
      try {
        const res = await analyzeStep({ data: { documentId, index } });
        const prompt = buildDelegatePlanPrompt({
          title: res.title,
          sentences: res.sentences,
          index: res.index,
          taskContext: res.taskContext,
          isSubstep: res.isSubstep,
          parentTask: res.parentTask,
        });
        const ok = await handleSendRef.current?.({
          text: prompt,
          caps: { ...DEFAULT_CAPS },
          auto: true,
          threadId,
          docIds: [documentId],
        });
        setDelegateAnalyzing(false);
        if (!ok) toast.error("Couldn't delegate that step");
      } catch (err) {
        setDelegateAnalyzing(false);
        toast.error(err instanceof Error ? err.message : "Couldn't delegate that step");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyzeStep],
  );


  useEffect(() => {
    if (!open || !delegate || !userId) return;
    if (delegateRef.current === delegate.id) return;
    delegateRef.current = delegate.id;
    (async () => {
      const t = await createThread(`Delegate: ${delegate.title}`.slice(0, 80));
      if (!t) return;
      setDrawerOpen(false);
      setActiveThreadId(t.id);
      await updateThread(t.id, {
        attached_document_ids: Array.from(new Set([delegate.documentId, ...autoAttachIds])),
      });
      await runDelegate(t.id, delegate.documentId, delegate.index);
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
                <PopoverContent align="end" className="w-72 max-h-[70vh] overflow-y-auto overscroll-contain">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-2">
                      <div className="min-w-0">
                        <Label htmlFor="cap-auto-approve" className="text-sm">
                          Auto approve plans
                        </Label>
                        <p className="text-[11px] leading-tight text-muted-foreground">
                          Run plans in this chat without asking me first
                        </p>
                      </div>
                      <Checkbox
                        id="cap-auto-approve"
                        className="mt-0.5"
                        checked={autoApprovePlans}
                        onCheckedChange={(v) => setAutoApprovePlans(v === true)}
                      />
                    </div>

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
                          onClick={clearCaps}
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
                        setTitlePickerOpen(true);
                      }}
                    >
                      <Type className="mr-2 h-4 w-4" /> Attach Image titles
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setSettingsOpen(false);
                        setImagePickerOpen(true);
                      }}
                    >
                      <ImageIcon className="mr-2 h-4 w-4" /> Attach Image to Analyze
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
            {messages.length === 0 && !isActiveBusy && !delegateAnalyzing ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                <MessagesSquare className="mb-1 h-6 w-6 opacity-50" />
                Ask Orby anything — chat, search, edit your docs, or make images & videos.
              </div>
            ) : (
              <div ref={messagesListRef} className="flex flex-col gap-4">
                {messages.map((m) =>
                  m.kind === "plan" && m.plan_id ? (
                    <div key={m.id} className="flex flex-col items-start">
                      <PlanProgressCard
                        planId={m.plan_id}
                        autoSpeak={autoSpeak && open}
                        onSteer={(t) => void handleSend({ text: t, threadId: activeThreadId ?? undefined })}
                      />
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
                        <ChatMediaRow titles={quotedTitles(m.content)} className="mt-2" />
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
                        {m.role === "assistant" && (
                          <button
                            type="button"
                            onClick={() => setNewDocFor(m)}
                            aria-label="Create new document from this reply"
                            className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
                          >
                            <FilePlus className="h-3.5 w-3.5" />
                          </button>
                        )}
                       </div>
                     </div>
                   ),
                )}
                {delegateAnalyzing && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-foreground/40" />
                    Reading your document…
                  </div>
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

            {threadSchedules.length > 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
                {threadSchedules.map((s: any) => (
                  <span
                    key={s.id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-2.5 py-1 text-xs"
                    title={s.user_request}
                  >
                    <Clock className="h-3 w-3" />
                    <span className="max-w-[150px] truncate">
                      {s.enabled && s.next_run_at
                        ? new Date(s.next_run_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "paused"}
                    </span>
                    <button
                      type="button"
                      aria-label={s.enabled ? "Pause scheduled message" : "Resume scheduled message"}
                      onClick={async () => {
                        try {
                          await toggleScheduleFn({ data: { id: s.id, enabled: !s.enabled } });
                          refetchSchedules();
                        } catch (e: any) {
                          toast.error(e?.message ?? "Couldn't update");
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {s.enabled ? <Pause className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete scheduled message"
                      onClick={async () => {
                        try {
                          await deleteScheduleFn({ data: { id: s.id } });
                          refetchSchedules();
                        } catch (e: any) {
                          toast.error(e?.message ?? "Couldn't delete");
                        }
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

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
              <Button
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => {
                  if (!activeThreadId) return;
                  if (!input.trim()) {
                    toast.error("Type the message you want to schedule first");
                    return;
                  }
                  setScheduleOpen(true);
                }}
                aria-label="Schedule this message"
                title="Send this message later (works with the app closed)"
                className="shrink-0"
              >
                <Clock className="h-4 w-4" />
              </Button>
              <Textarea

                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  cursorRef.current = e.target.selectionStart ?? e.target.value.length;
                }}
                onSelect={(e) => {
                  cursorRef.current = e.currentTarget.selectionStart ?? 0;
                }}
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
                    onClick={() => {
                      setDrawerOpen(false);
                      setThreadSearch("");
                    }}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                  <span className="text-base font-medium">Chats</span>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAutoAttachOpen(true)}
                    aria-label="Auto-attach documents to new chats"
                  >
                    <Paperclip className="mr-1 h-3.5 w-3.5" /> Auto
                    {autoAttachIds.length > 0 && (
                      <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {autoAttachIds.length}
                      </span>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleNewThread()}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> New
                  </Button>
                </div>
              </div>
              <div className="border-b border-foreground/10 px-3 pb-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={threadSearch}
                    onChange={(e) => setThreadSearch(e.target.value)}
                    placeholder="Search chats…"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {filteredThreads.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {threads.length === 0 ? "No chats yet." : "No chats match your search."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {filteredThreads.map((t) => (
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
                            bumpThread(t.id);
                            setDrawerOpen(false);
                          }}
                          className={`flex min-w-0 flex-1 items-center gap-2 px-1 py-3.5 text-left text-base ${
                            isUnread(t) ? "font-semibold text-foreground" : ""
                          }`}
                        >
                          {isUnread(t) && (
                            <span
                              aria-label="Unread"
                              className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
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

      {/* Documents attached automatically to every new chat. */}
      <DocumentPickerSheet
        open={autoAttachOpen}
        onOpenChange={setAutoAttachOpen}
        initialSelectedIds={autoAttachIds}
        onConfirm={(ids) => {
          void saveAutoAttach(ids)
            .then(() =>
              toast.success(
                ids.length === 0
                  ? "New chats will start with no documents"
                  : `${ids.length} document${ids.length === 1 ? "" : "s"} auto-attached to new chats`,
              ),
            )
            .catch((e) =>
              toast.error(e instanceof Error ? e.message : "Couldn't save auto-attach"),
            );
        }}
      />


      {/* Schedule the message currently in the composer, in this thread. */}
      <ScheduleEditorDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        defaults={{
          title: input.trim().slice(0, 60) || "Scheduled message",
          user_request: input.trim(),
          attached_document_ids: contextDocIds,
          thread_id: activeThreadId,
          capabilities: caps as unknown as Record<string, boolean>,
          image_urls: pickedImages.map((a) => a.url).filter((u): u is string => !!u),
        }}
        onSaved={() => {
          setInput("");
          setPickedImages([]);
          refetchSchedules();
          toast.success("Orby will send that later");
        }}
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

      <MediaGalleryPicker
        open={titlePickerOpen}
        onOpenChange={setTitlePickerOpen}
        kind="image"
        mode="multiple"
        maxSelected={30}
        heading="Attach Image titles"
        showTitles
        allowManage
        onConfirm={insertTitlesAtCursor}
      />

      <InsertIntoDocDialog
        row={insertFor}
        onClose={() => setInsertFor(null)}
        currentDocumentId={currentDocumentId}
        documents={documents}
      />

      <NewDocFromReplyDialog row={newDocFor} onClose={() => setNewDocFor(null)} />
    </>
  );
}

/** ＋ button under a reply: create a brand-new document holding that reply. */
function NewDocFromReplyDialog({
  row,
  onClose,
}: {
  row: ChatRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    const suggestion = (row.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 6)
      .join(" ")
      .slice(0, 60);
    setTitle(suggestion);
  }, [row]);

  const create = async () => {
    if (!row || busy) return;
    const sentences = splitIntoSentences(row.content);
    if (sentences.length === 0) {
      toast.error("Nothing to save");
      return;
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { count } = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.user.id);
      const finalTitle = title.trim() || "Untitled";
      const { data: doc, error: dErr } = await supabase
        .from("documents")
        .insert({ user_id: u.user.id, title: finalTitle, position: count ?? 0 })
        .select("id")
        .single();
      if (dErr || !doc) throw new Error(dErr?.message || "Couldn't create the document");
      const { error: sErr } = await supabase.rpc("insert_sentences_at", {
        p_document_id: doc.id,
        p_contents: sentences,
        p_insert_at: 0,
      });
      if (sErr) throw sErr;
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["sentences", doc.id] });
      toast.success(`Created ${finalTitle}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the document");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl border border-foreground/10 bg-card/95 p-4 backdrop-blur">
        <DialogHeader className="mb-2 px-1">
          <DialogTitle className="font-display text-lg">Name your new document</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="Untitled"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  user_request?: string;
  review_in_chat?: boolean | null;
  proposed_capabilities?: Record<string, boolean> | null;
};

const PLAN_DONE = new Set(["completed", "failed", "cancelled", "proposed"]);

function PlanProgressCard({
  planId,
  autoSpeak = false,
  onSteer,
}: {
  planId: string;
  autoSpeak?: boolean;
  onSteer?: (text: string) => void;
}) {
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
        .select(
          "id, status, plan_summary, result_summary, error_message, current_step, total_steps, steps, user_request, review_in_chat, proposed_capabilities",
        )
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
  const planMediaIds = extractArtifacts(steps).mediaIds;


  // A plan Orby proposed inside the chat waits here for approval / a note.
  if (plan.status === "proposed" && (plan as any).review_in_chat) {
    return (
      <PlanReviewCard
        plan={{
          id: plan.id,
          plan_summary: plan.plan_summary,
          user_request: (plan as any).user_request ?? "",
          steps,
          proposed_capabilities: ((plan as any).proposed_capabilities ?? null) as Record<
            string,
            boolean
          > | null,
        }}
      />
    );
  }

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
      {/* Anything this plan made or touched, shown right here in the chat. */}
      {planMediaIds.length > 0 && <ChatMediaRow ids={planMediaIds} className="mt-2" />}
      {plan.status === "failed" && plan.error_message && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-destructive">{plan.error_message}</p>
      )}
      {(plan.status === "failed" || plan.status === "cancelled") && onSteer && (
        <PlanSteerBox onSend={onSteer} />
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
