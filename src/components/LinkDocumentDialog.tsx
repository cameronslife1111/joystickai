import { useEffect, useState, useMemo } from "react";
import { toast } from "@/lib/toast";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { sortDocsByTitle } from "@/lib/sortDocs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sentenceId: string;
  currentLinkedDocumentId: string | null;
  currentLinkedThreadId?: string | null;
  documents: { id: string; title: string }[];
  excludeDocumentId?: string;
  onSaved: () => void;
}

const EMOJI_FILTERS = ["⚪️", "⚫️", "🟣", "🔵", "🔴", "🟢", "🟡", "🟠", "🟤"];

type Tab = "docs" | "chats";
type Thread = { id: string; title: string };

export function LinkDocumentDialog({
  open,
  onOpenChange,
  sentenceId,
  currentLinkedDocumentId,
  currentLinkedThreadId = null,
  documents,
  excludeDocumentId,
  onSaved,
}: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("docs");

  useEffect(() => {
    if (open) {
      setQuery("");
      setTab(currentLinkedThreadId ? "chats" : "docs");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Always pull a fresh list when the picker opens: documents created by a
  // chat plan on the server won't be in the caller's snapshot yet.
  const { data: freshDocs } = useQuery({
    queryKey: ["link_documents"],
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<{ id: string; title: string }[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title")
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; title: string }[];
    },
  });

  const { data: threads = [] } = useQuery({
    queryKey: ["link_chat_threads"],
    enabled: open,
    queryFn: async (): Promise<Thread[]> => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("id, title")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Thread[];
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = freshDocs && freshDocs.length > 0 ? freshDocs : documents;
    return sortDocsByTitle(
      list.filter((d) => {
        if (excludeDocumentId && d.id === excludeDocumentId) return false;
        if (!q) return true;
        return (d.title || "").toLowerCase().includes(q);
      })
    );
  }, [documents, query, excludeDocumentId]);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => (t.title || "").toLowerCase().includes(q));
  }, [threads, query]);

  /** Writes the link to every identical sentence in the same document. */
  const applyLink = async (patch: {
    linked_document_id: string | null;
    linked_thread_id: string | null;
  }) => {
    try {
      setBusy(true);
      const { data: row, error: rowErr } = await supabase
        .from("sentences")
        .select("content, document_id")
        .eq("id", sentenceId)
        .maybeSingle();
      if (rowErr) throw rowErr;

      if (row) {
        const { error } = await supabase
          .from("sentences")
          .update(patch)
          .eq("document_id", row.document_id)
          .eq("content", row.content);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("sentences")
          .update(patch)
          .eq("id", sentenceId);
        if (error) throw error;
      }
      const linked = patch.linked_document_id || patch.linked_thread_id;
      toast.success(linked ? "Sentence linked" : "Link removed");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update link");
    } finally {
      setBusy(false);
    }
  };

  const pickDoc = (docId: string) =>
    applyLink({ linked_document_id: docId, linked_thread_id: null });
  const pickThread = (threadId: string) =>
    applyLink({ linked_document_id: null, linked_thread_id: threadId });
  const unlink = () => applyLink({ linked_document_id: null, linked_thread_id: null });

  const hasLink = !!currentLinkedDocumentId || !!currentLinkedThreadId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Link this sentence</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tap a document or chat to link. Tap again to switch. Use the button below to unlink.
          </p>
        </DialogHeader>
        <div className="flex rounded-xl border border-foreground/10 bg-foreground/5 p-1">
          {(["docs", "chats"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setQuery("");
              }}
              className={
                "flex-1 rounded-lg px-3 py-1.5 text-sm transition " +
                (tab === t
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "text-muted-foreground hover:bg-foreground/10")
              }
            >
              {t === "docs" ? "Docs" : "Chats"}
            </button>
          ))}
        </div>
        {tab === "docs" && (
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_FILTERS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setQuery(emoji)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-foreground/10 bg-foreground/5 text-lg transition hover:bg-foreground/10 active:scale-[0.95]"
                aria-label={`Filter by ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "docs" ? "Search documents…" : "Search chats…"}
        />
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {tab === "docs" ? (
            filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No matching documents.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {filtered.map((d) => {
                  const isLinked = d.id === currentLinkedDocumentId;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => pickDoc(d.id)}
                        className={
                          "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition active:scale-[0.98] " +
                          (isLinked
                            ? "border-primary/40 bg-primary/10 ring-1 ring-primary/40"
                            : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10")
                        }
                      >
                        <span className="truncate">{d.title || "Untitled"}</span>
                        {isLinked && (
                          <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                            Linked
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : filteredThreads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No matching chats.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {filteredThreads.map((t) => {
                const isLinked = t.id === currentLinkedThreadId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pickThread(t.id)}
                      className={
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition active:scale-[0.98] " +
                        (isLinked
                          ? "border-primary/40 bg-primary/10 ring-1 ring-primary/40"
                          : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10")
                      }
                    >
                      <span className="truncate">💬 {t.title || "Chat"}</span>
                      {isLinked && (
                        <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                          Linked
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="flex !flex-row !justify-between gap-2 sm:!justify-between">
          {hasLink ? (
            <Button variant="outline" disabled={busy} onClick={unlink}>
              Unlink
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
