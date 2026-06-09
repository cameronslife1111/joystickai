import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
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
  documents: { id: string; title: string }[];
  excludeDocumentId?: string;
  onSaved: () => void;
}

export function LinkDocumentDialog({
  open,
  onOpenChange,
  sentenceId,
  currentLinkedDocumentId,
  documents,
  excludeDocumentId,
  onSaved,
}: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortDocsByTitle(
      documents.filter((d) => {
        if (excludeDocumentId && d.id === excludeDocumentId) return false;
        if (!q) return true;
        return (d.title || "").toLowerCase().includes(q);
      })
    );
  }, [documents, query, excludeDocumentId]);

  const handlePick = async (docId: string | null) => {
    try {
      setBusy(true);
      const { data: row, error: rowErr } = await supabase
        .from("sentences")
        .select("content, document_id")
        .eq("id", sentenceId)
        .maybeSingle();
      if (rowErr) throw rowErr;

      if (row) {
        // Apply the same link to every identical sentence in the same document.
        const { error } = await supabase
          .from("sentences")
          .update({ linked_document_id: docId })
          .eq("document_id", row.document_id)
          .eq("content", row.content);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("sentences")
          .update({ linked_document_id: docId })
          .eq("id", sentenceId);
        if (error) throw error;
      }
      toast.success(docId ? "Sentence linked" : "Link removed");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Link this sentence</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tap a document to link. Tap again to switch. Use the button below to unlink.
          </p>
        </DialogHeader>
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
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
        />
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
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
                      onClick={() => handlePick(d.id)}
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
          )}
        </div>
        <DialogFooter className="flex !flex-row !justify-between gap-2 sm:!justify-between">
          {currentLinkedDocumentId ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => handlePick(null)}
            >
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
