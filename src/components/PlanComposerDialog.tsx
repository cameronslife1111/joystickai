import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { sortDocsByTitle } from "@/lib/sortDocs";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originDocumentId: string | null;
  originSentenceIndex: number | null;
  onPlanProposed?: (planId: string) => void;
}

const SUGGESTIONS = [
  "Find and mark for deletion…",
  "Search the web and add to a doc…",
  "Create a new doc and add sentences…",
  "Move sentences between docs…",
];

const MAX_ATTACHMENTS = 10;

type DocRow = { id: string; title: string; sentence_count: number };

export function PlanComposerDialog({ open, onOpenChange, onPlanProposed }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [attachedIds, setAttachedIds] = useState<string[]>([]);

  const { data: docs = [], isLoading: docsLoading } = useQuery({
    queryKey: ["plan_composer_docs"],
    enabled: open,
    queryFn: async (): Promise<DocRow[]> => {
      const { data: documents, error } = await supabase
        .from("documents")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const ids = (documents ?? []).map((d) => d.id);
      if (ids.length === 0) return [];
      const { data: sentences } = await supabase
        .from("sentences")
        .select("document_id")
        .in("document_id", ids);
      const counts = new Map<string, number>();
      (sentences ?? []).forEach((s: any) => {
        counts.set(s.document_id, (counts.get(s.document_id) ?? 0) + 1);
      });
      return sortDocsByTitle(
        (documents ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          sentence_count: counts.get(d.id) ?? 0,
        })),
      );
    },
  });

  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    docs.forEach((d) => m.set(d.id, d.title));
    return m;
  }, [docs]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => (d.title ?? "").toLowerCase().includes(q));
  }, [docs, search]);

  const atCap = attachedIds.length >= MAX_ATTACHMENTS;

  const toggleAttach = (id: string) => {
    setAttachedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_ATTACHMENTS) return cur;
      return [...cur, id];
    });
  };

  const reset = () => {
    setText("");
    setAttachedIds([]);
    setSearch("");
    setPickerOpen(false);
  };

  const submit = async () => {
    const value = text.trim();
    if ((!value && attachedIds.length === 0) || busy) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { toast.error("Sign in first"); return; }
      const requestText =
        value || "(no instructions — see attached documents)";
      const { data: row, error } = await supabase
        .from("plans")
        .insert({
          user_id: u.user.id,
          status: "composing",
          user_request: requestText,
          attached_document_ids: attachedIds,
        })
        .select()
        .single();
      if (error || !row) throw new Error(error?.message || "Failed to create plan");
      reset();
      onOpenChange(false);
      void supabase.functions.invoke("plan-compose", { body: { plan_id: row.id } });
      toast("Orby is planning… you can keep working", { duration: 3000 });
      onPlanProposed?.(row.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start plan");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = (text.trim().length > 0 || attachedIds.length > 0) && !busy;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { if (!v) reset(); onOpenChange(v); } }}>
      <DialogContent
        className="w-[calc(100vw-1rem)] max-w-lg h-[85svh] sm:h-auto sm:max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <DialogHeader className="shrink-0 min-w-0 border-b border-border px-4 pt-5 pb-3 sm:px-6 sm:pt-6 sm:pb-4 text-left">
          <DialogTitle className="pr-8 min-w-0 break-words">Ask Orby to do something</DialogTitle>
          <DialogDescription className="min-w-0 break-words">
            Type a request and/or attach documents. With attachments only, Orby will plan based on the documents.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-6 sm:py-4 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            autoFocus
            placeholder="e.g. Summarize the attached docs into a single overview…"
            className="min-h-[5rem] max-h-[12rem] w-full min-w-0 resize-y"
          />

          {/* Attached doc chips */}
          {attachedIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {attachedIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs"
                >
                  <span className="min-w-0 max-w-[12rem] truncate">{titleById.get(id) ?? "Untitled"}</span>
                  <button
                    type="button"
                    onClick={() => toggleAttach(id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Attach docs picker */}
          <div className="rounded-md border border-border min-w-0">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
            >
              <span className="min-w-0 truncate">
                {attachedIds.length > 0
                  ? `Attached documents (${attachedIds.length}/${MAX_ATTACHMENTS})`
                  : "+ Attach documents"}
              </span>
              <span className="shrink-0 text-muted-foreground">{pickerOpen ? "▴" : "▾"}</span>
            </button>
            {pickerOpen && (
              <div className="border-t border-border p-2 space-y-2 min-w-0">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search documents…"
                  className="h-8 w-full min-w-0 text-sm"
                />
                <div className="max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded-md border border-border/50 bg-background/40">
                  {docsLoading ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
                  ) : filteredDocs.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      {docs.length === 0 ? "No documents yet." : "No matches."}
                    </p>
                  ) : (
                    <ul className="flex flex-col min-w-0">
                      {filteredDocs.map((d) => {
                        const checked = attachedIds.includes(d.id);
                        const disabled = !checked && atCap;
                        return (
                          <li key={d.id} className="min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleAttach(d.id)}
                              disabled={disabled}
                              className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggleAttach(d.id)} />
                              <span className="min-w-0 flex-1 truncate">{d.title || "Untitled"}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {d.sentence_count}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {atCap && (
                  <p className="text-[11px] text-muted-foreground">Maximum {MAX_ATTACHMENTS} documents.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 min-w-0">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setText(s)}
                className="max-w-full truncate rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Pinned footer */}
        <div
          className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:px-6"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => { reset(); onOpenChange(false); }}
            disabled={busy}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Planning…" : "Generate Plan"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
