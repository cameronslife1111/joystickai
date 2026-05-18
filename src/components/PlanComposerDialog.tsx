import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originDocumentId: string | null;
  originSentenceIndex: number | null;
  onPlanProposed: (planId: string) => void;
}

const SUGGESTIONS = [
  "Find and mark for deletion…",
  "Search the web and add to a doc…",
  "Create a new doc and add sentences…",
  "Move sentences between docs…",
];

export function PlanComposerDialog({ open, onOpenChange, originDocumentId, originSentenceIndex, onPlanProposed }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { toast.error("Sign in first"); return; }
      const { data: row, error } = await supabase
        .from("plans")
        .insert({
          user_id: u.user.id,
          status: "composing",
          user_request: value,
          origin_document_id: originDocumentId,
          origin_sentence_index: originSentenceIndex,
        })
        .select()
        .single();
      if (error || !row) throw new Error(error?.message || "Failed to create plan");
      setText("");
      onOpenChange(false);
      onPlanProposed(row.id);
      // Fire compose without awaiting so the approval modal shows its spinner immediately
      void supabase.functions.invoke("plan-compose", { body: { plan_id: row.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask Orby to do something</DialogTitle>
          <DialogDescription>
            Type or paste a request. Orby will plan it out and ask you to approve before doing anything.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          autoFocus
          placeholder="e.g. Find any sentence about dinner plans in any of my docs and add a wastebasket emoji to it."
          className="min-h-[8rem] max-h-[16rem]"
        />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setText(s)}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!text.trim() || busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Planning…" : "Generate Plan"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
