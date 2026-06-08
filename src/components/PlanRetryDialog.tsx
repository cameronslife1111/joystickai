import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string | null;
  failedStepNumber: number | null;
  totalSteps: number | null;
  errorMessage: string | null;
  /** Called after a successful retry so the parent (detail dialog) can close. */
  onRetried?: () => void;
}

export function PlanRetryDialog({
  open,
  onOpenChange,
  planId,
  failedStepNumber,
  totalSteps,
  errorMessage,
  onRetried,
}: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setNote("");
  }, [open, planId]);

  const handleRetry = async () => {
    if (!planId || submitting) return;
    setSubmitting(true);
    // Fire-and-forget: kick off the background repair, then immediately close
    // and let the user leave the screen. The plan shows as "retrying" in the
    // Active tab and resumes on its own once the repair finishes.
    const id = planId;
    const trimmedNote = note.trim() || undefined;
    supabase.functions
      .invoke("plan-retry", { body: { plan_id: id, note: trimmedNote } })
      .then(async ({ error }) => {
        if (error) {
          let detail = error.message;
          try {
            const ctx = await (error as any)?.context?.json?.();
            if (ctx?.error) detail = ctx.error;
          } catch { /* ignore */ }
          toast.error(`Couldn't start retry: ${detail}`);
        }
        qc.invalidateQueries({ queryKey: ["plans"] });
        qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
        qc.invalidateQueries({ queryKey: ["plan", id, "detail"] });
      });

    toast.success("Retrying in the background — safe to leave this screen");
    qc.invalidateQueries({ queryKey: ["plans"] });
    setSubmitting(false);
    onOpenChange(false);
    onRetried?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85vh] overflow-y-auto overflow-x-hidden break-words">
        <DialogHeader>
          <DialogTitle>Fix &amp; retry plan</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Orby will study what went wrong and resume this plan
          {failedStepNumber ? (
            <> from <span className="font-medium text-foreground">step {failedStepNumber}{totalSteps ? ` of ${totalSteps}` : ""}</span></>
          ) : null}
          {" "}— no need to start over.
        </p>

        {errorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="text-xs uppercase tracking-wider text-destructive">What went wrong</div>
            <p className="mt-1 text-xs text-red-400 whitespace-pre-wrap break-all">{errorMessage}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="retry-note" className="text-xs uppercase tracking-wider text-muted-foreground">
            Add a note for Orby (optional)
          </label>
          <Textarea
            id="retry-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Don't use more than 10 reference images, or skip the broken step…"
            className="min-h-[96px] resize-none text-sm"
            maxLength={4000}
            disabled={submitting}
          />
          <p className="text-[11px] text-muted-foreground/70">
            Tell Orby what to avoid or how to fix the mistake.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            onClick={() => { if (!submitting) onOpenChange(false); }}
            disabled={submitting}
            className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleRetry}
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Retrying…" : "Retry plan"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
