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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { sendChatMessage } from "@/lib/chat.functions";
import { splitIntoSentences } from "@/lib/sentences";
import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { DestinationPicker, type DestinationPosition } from "./DestinationPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocumentId: string | null;
  documents: { id: string; title: string }[];
}

type ChatRow = { id: string; role: "user" | "assistant"; content: string; created_at: string };

const stripEmoji = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

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

export function ChatDialog({ open, onOpenChange, currentDocumentId, documents }: Props) {
  const qc = useQueryClient();
  const send = useServerFn(sendChatMessage);

  const [userId, setUserId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [analyzeImage, setAnalyzeImage] = useState(false);
  const [contextDocIds, setContextDocIds] = useState<string[]>([]);
  const [pickedImage, setPickedImage] = useState<MediaAsset | null>(null);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [insertFor, setInsertFor] = useState<ChatRow | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: messages = [] } = useQuery({
    queryKey: ["chat_messages", userId],
    enabled: !!userId && open,
    queryFn: async (): Promise<ChatRow[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatRow[];
    },
  });

  // Focus textarea on open.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Auto-scroll on new messages / busy state.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, [messages, busy, open]);

  // Stop speech if the dialog closes.
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

  const handleClear = async () => {
    if (!userId) return;
    if (!confirm("Clear the entire chat? This cannot be undone.")) return;
    const { error } = await supabase.from("chat_messages").delete().eq("user_id", userId);
    if (error) {
      toast.error("Failed to clear chat");
      return;
    }
    qc.setQueryData(["chat_messages", userId], []);
    setSettingsOpen(false);
    toast.success("Chat cleared");
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || busy || !userId) return;
    if (analyzeImage && pickedImage && !pickedImage.url) {
      toast.error("That image has no URL yet");
      return;
    }

    setBusy(true);
    setInput("");

    // Persist + optimistically show the user message.
    const optimisticUser: ChatRow = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    const prior = (qc.getQueryData<ChatRow[]>(["chat_messages", userId]) ?? []);
    qc.setQueryData(["chat_messages", userId], [...prior, optimisticUser]);

    try {
      const { data: insertedUser, error: userErr } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, role: "user", content: text })
        .select("id, role, content, created_at")
        .single();
      if (userErr) throw userErr;

      const history = [...prior, insertedUser as ChatRow].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await send({
        data: {
          messages: history,
          contextDocumentIds: contextDocIds,
          imageUrl: analyzeImage && pickedImage?.url ? pickedImage.url : undefined,
          webSearch,
          analyzeImage,
        },
      });

      const { data: insertedAssistant, error: aErr } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, role: "assistant", content: result.text })
        .select("id, role, content, created_at")
        .single();
      if (aErr) throw aErr;

      qc.setQueryData<ChatRow[]>(["chat_messages", userId], (cur) => {
        const base = (cur ?? []).filter((m) => m.id !== optimisticUser.id);
        return [...base, insertedUser as ChatRow, insertedAssistant as ChatRow];
      });
    } catch (err) {
      qc.invalidateQueries({ queryKey: ["chat_messages", userId] });
      toast.error(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setBusy(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-foreground/10 p-3">
            <DialogTitle className="text-base">Chat</DialogTitle>
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Chat settings" className="mr-8">
                  <SettingsIcon className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="chat-web" className="text-sm">Web search</Label>
                    <Switch id="chat-web" checked={webSearch} onCheckedChange={setWebSearch} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="chat-img" className="text-sm">Analyze image</Label>
                    <Switch
                      id="chat-img"
                      checked={analyzeImage}
                      onCheckedChange={(v) => {
                        setAnalyzeImage(v);
                        if (!v) setPickedImage(null);
                      }}
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
                    <ImageIcon className="mr-2 h-4 w-4" /> Attach image
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start text-destructive hover:text-destructive"
                    onClick={handleClear}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Clear chat
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </DialogHeader>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 && !busy ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                Start a conversation with Orby.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((m) => (
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
                ))}
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
            {/* Attach-document dropdown row + chips */}
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
                      onClick={() => setContextDocIds((cur) => cur.filter((x) => x !== id))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {analyzeImage && pickedImage && (
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

            {(webSearch || analyzeImage) && (
              <div className="mb-2 flex gap-1.5 text-[11px] text-muted-foreground">
                {webSearch && <span className="rounded bg-foreground/5 px-1.5 py-0.5">🌐 Web search on</span>}
                {analyzeImage && <span className="rounded bg-foreground/5 px-1.5 py-0.5">👁️ Analyze image on</span>}
              </div>
            )}

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
          if (assets[0]) {
            setPickedImage(assets[0]);
            setAnalyzeImage(true);
          }
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
