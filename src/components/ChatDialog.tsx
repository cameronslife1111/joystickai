import { useEffect, useMemo, useRef, useState } from "react";
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
  Eraser,
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
import ReactMarkdown from "react-markdown";
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
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { sendChatMessage, type ChatCapabilities } from "@/lib/chat.functions";
import { splitIntoSentences } from "@/lib/sentences";
import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { DestinationPicker, type DestinationPosition } from "./DestinationPicker";
import { StepReasoning } from "./plan/StepReasoning";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocumentId: string | null;
  documents: { id: string; title: string }[];
  /** When provided while opening, select this thread instead of the default. */
  openThreadId?: string | null;
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
};

const CAP_LABELS: { key: keyof ChatCapabilities; label: string; hint: string }[] = [
  { key: "planning", label: "Planning / multi-step", hint: "Combine steps to complete bigger tasks" },
  { key: "document_editing", label: "Document editing", hint: "Create, edit, organize your documents" },
  { key: "image_generation", label: "Image generation", hint: "Create & remix images to your gallery" },
  { key: "video_generation", label: "Video generation", hint: "Make videos to your gallery" },
  { key: "web_search", label: "Web search", hint: "Look up current info online" },
  { key: "image_analysis", label: "Image analysis", hint: "Describe & analyze attached images" },
];

// action groups that map to plan tool groups
const ACTION_TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "web_search",
];

const stripEmoji = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

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

export function ChatDialog({ open, onOpenChange, currentDocumentId, documents, openThreadId }: Props) {
  const qc = useQueryClient();
  const send = useServerFn(sendChatMessage);

  const [userId, setUserId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickedImage, setPickedImage] = useState<MediaAsset | null>(null);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [insertFor, setInsertFor] = useState<ChatRow | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteThreadId, setDeleteThreadId] = useState<string | null>(null);
  const [renameThread, setRenameThread] = useState<Thread | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: threads = [] } = useQuery({
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
  const caps = activeThread?.capabilities ?? DEFAULT_CAPS;
  const contextDocIds = activeThread?.attached_document_ids ?? [];

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

  // Bootstrap: pick a thread when the dialog opens.
  useEffect(() => {
    if (!open) {
      bootstrappedRef.current = false;
      return;
    }
    if (bootstrappedRef.current || !userId) return;
    // wait for threads query
    if (threads === undefined) return;
    bootstrappedRef.current = true;
    (async () => {
      if (openThreadId && threads.some((t) => t.id === openThreadId)) {
        setActiveThreadId(openThreadId);
      } else if (threads.length > 0) {
        setActiveThreadId(threads[0].id);
      } else {
        const t = await createThread("Chat");
        if (t) setActiveThreadId(t.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, threads, openThreadId]);

  const { data: messages = [] } = useQuery({
    queryKey: ["chat_messages", activeThreadId],
    enabled: !!activeThreadId && open,
    queryFn: async (): Promise<ChatRow[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at, kind, plan_id")
        .eq("thread_id", activeThreadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatRow[];
    },
  });

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
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    }
  }, [open]);

  const toggleSpeak = (row: ChatRow) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speakingId === row.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const clean = stripEmoji(row.content);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1;
    u.pitch = 1;
    u.onend = () => setSpeakingId((cur) => (cur === row.id ? null : cur));
    u.onerror = () => setSpeakingId((cur) => (cur === row.id ? null : cur));
    setSpeakingId(row.id);
    window.speechSynthesis.speak(u);
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
    if (!activeThreadId) return;
    void updateThread(activeThreadId, { capabilities: { ...caps, [key]: value } });
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || busy || !userId || !activeThreadId) return;
    const threadId = activeThreadId;
    if (caps.image_analysis && pickedImage && !pickedImage.url) {
      toast.error("That image has no URL yet");
      return;
    }

    setBusy(true);
    setInput("");

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

      const history = [...prior, insertedUser as ChatRow]
        .filter((m) => m.kind !== "plan")
        .map((m) => ({ role: m.role, content: m.content }));

      const result = await send({
        data: {
          messages: history,
          contextDocumentIds: contextDocIds,
          imageUrl: caps.image_analysis && pickedImage?.url ? pickedImage.url : undefined,
          capabilities: caps,
        },
      });

      let insertedAssistant: ChatRow;
      if (result.route === "plan") {
        // Create + auto-run a plan tied to this thread.
        const allowedGroups = ACTION_TOOL_GROUPS.filter((g) => caps[g]);
        const { data: planRow, error: planErr } = await supabase
          .from("plans")
          .insert({
            user_id: userId,
            status: "composing",
            user_request: text,
            attached_document_ids: contextDocIds,
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
        return [...base, insertedUser as ChatRow, insertedAssistant];
      });
      // bump thread ordering
      void supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
    } catch (err) {
      qc.invalidateQueries({ queryKey: ["chat_messages", threadId] });
      toast.error(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setBusy(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const enabledCapCount = Object.values(caps).filter(Boolean).length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-foreground/10 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Threads"
                onClick={() => setDrawerOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <DialogTitle className="truncate text-base">
                {activeThread?.title ?? "Chat"}
              </DialogTitle>
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
                    <p className="text-xs font-medium text-muted-foreground">Orby capabilities</p>
                    {CAP_LABELS.map(({ key, label, hint }) => (
                      <div key={key} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Label htmlFor={`cap-${key}`} className="text-sm">{label}</Label>
                          <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
                        </div>
                        <Switch
                          id={`cap-${key}`}
                          checked={caps[key]}
                          onCheckedChange={(v) => setCap(key, v)}
                        />
                      </div>
                    ))}
                    {caps.image_analysis && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => {
                          setSettingsOpen(false);
                          setImagePickerOpen(true);
                        }}
                      >
                        <ImageIcon className="mr-2 h-4 w-4" /> Attach image
                      </Button>
                    )}
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
          </DialogHeader>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 && !busy ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                <MessagesSquare className="mb-1 h-6 w-6 opacity-50" />
                Ask Orby anything — chat, search, edit your docs, or make images & videos.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((m) =>
                  m.kind === "plan" && m.plan_id ? (
                    <div key={m.id} className="flex flex-col items-start">
                      <PlanProgressCard planId={m.plan_id} />
                    </div>
                  ) : (
                    <div
                      key={m.id}
                      className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}
                    >
                      <div
                        className={
                          m.role === "user"
                            ? "max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                            : "max-w-[90%] text-sm"
                        }
                      >
                        {m.role === "assistant" ? (
                          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-headings:my-2 prose-li:my-0.5">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <span className="whitespace-pre-wrap">{m.content}</span>
                        )}
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
                {busy && (
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
                    <span className="max-w-[140px] truncate">{d?.title ?? "Document"}</span>
                    <button
                      type="button"
                      onClick={() => setContextDocIds(contextDocIds.filter((x) => x !== id))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {caps.image_analysis && pickedImage && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-2.5 py-1 text-xs">
                  <ImageIcon className="h-3 w-3" />
                  <span className="max-w-[120px] truncate">{pickedImage.title || "Image"}</span>
                  <button
                    type="button"
                    onClick={() => setPickedImage(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>

            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <SettingsIcon className="h-3 w-3" />
              {enabledCapCount === 6 ? "All capabilities on" : `${enabledCapCount}/6 capabilities on`}
            </div>

            <div className="flex items-end gap-2">
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
                disabled={busy || !input.trim()}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Threads drawer */}
          {drawerOpen && (
            <div className="absolute inset-0 z-20 flex">
              <div className="flex w-72 max-w-[80%] flex-col border-r border-foreground/10 bg-background shadow-xl">
                <div className="flex items-center justify-between border-b border-foreground/10 p-3">
                  <span className="text-sm font-medium">Chats</span>
                  <Button size="sm" variant="outline" onClick={() => void handleNewThread()}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> New
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {threads.length === 0 ? (
                    <p className="p-4 text-center text-xs text-muted-foreground">No chats yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {threads.map((t) => (
                        <li
                          key={t.id}
                          className={`flex items-center gap-1 rounded-lg px-1 ${
                            t.id === activeThreadId ? "bg-foreground/10" : "hover:bg-foreground/5"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveThreadId(t.id);
                              setDrawerOpen(false);
                            }}
                            className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
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
                            className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Clear messages"
                            onClick={async () => {
                              await supabase.from("chat_messages").delete().eq("thread_id", t.id);
                              qc.setQueryData(["chat_messages", t.id], []);
                              toast.success("Chat cleared");
                            }}
                            className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            <Eraser className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete thread"
                            onClick={() => setDeleteThreadId(t.id)}
                            className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close threads"
                className="flex-1 bg-black/30"
                onClick={() => setDrawerOpen(false)}
              />
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
        mode="single"
        initialSelectedIds={pickedImage ? [pickedImage.id] : []}
        onConfirm={(assets) => {
          if (assets[0]) setPickedImage(assets[0]);
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

function PlanProgressCard({ planId }: { planId: string }) {
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
        {headerLabel}
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
  const [targetDocumentId, setTargetDocumentId] = useState(currentDocumentId ?? "");
  const [position, setPosition] = useState<DestinationPosition>("after_current");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (row) {
      setTargetDocumentId(currentDocumentId ?? "");
      setPosition("after_current");
    }
  }, [row, currentDocumentId]);

  const handleInsert = async () => {
    if (!row || !targetDocumentId) return;
    const sentences = splitIntoSentences(row.content);
    if (sentences.length === 0) {
      toast.error("Nothing to insert");
      return;
    }
    setBusy(true);
    try {
      let insertAt = 0;
      if (position === "top") {
        insertAt = 0;
      } else if (position === "bottom") {
        const { count } = await supabase
          .from("sentences")
          .select("id", { count: "exact", head: true })
          .eq("document_id", targetDocumentId);
        insertAt = count ?? 0;
      } else {
        const { data: doc } = await supabase
          .from("documents")
          .select("current_sentence_index")
          .eq("id", targetDocumentId)
          .single();
        const cur = typeof doc?.current_sentence_index === "number" ? doc.current_sentence_index : -1;
        insertAt = cur + 1;
      }
      const { error } = await supabase.rpc("insert_sentences_at", {
        p_document_id: targetDocumentId,
        p_contents: sentences,
        p_insert_at: insertAt,
      });
      if (error) throw error;
      toast.success(`Inserted ${sentences.length} sentence${sentences.length === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["sentences", targetDocumentId] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Insert failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Insert into document</DialogTitle>
        </DialogHeader>
        <DestinationPicker
          documents={documents}
          targetDocumentId={targetDocumentId}
          onTargetDocumentIdChange={setTargetDocumentId}
          position={position}
          onPositionChange={setPosition}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={busy || !targetDocumentId}>
            {busy ? "Inserting…" : "Insert"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
