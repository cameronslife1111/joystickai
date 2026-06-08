import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlanRetryDialog } from "./PlanRetryDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string | null;
}

const STEP_STATUS_COLOR: Record<string, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-300",
  completed: "text-green-400",
  failed: "text-red-400",
};

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function PlanDetailDialog({ open, onOpenChange, planId }: Props) {
  const [retryOpen, setRetryOpen] = useState(false);
  const { data: plan } = useQuery({
    queryKey: ["plan", planId, "detail"],
    enabled: !!planId && open,
    queryFn: async () => {
      if (!planId) return null;
      const { data } = await supabase.from("plans").select("*").eq("id", planId).single();
      return data;
    },
  });

  if (!plan) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>Plan</DialogTitle></DialogHeader>
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        </DialogContent>
      </Dialog>
    );
  }

  const steps: any[] = Array.isArray(plan.steps) ? plan.steps : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden break-words">
        <DialogHeader>
          <DialogTitle>Plan detail</DialogTitle>
        </DialogHeader>

        <section className="space-y-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Your request</div>
          <p className="text-sm whitespace-pre-wrap break-words">{plan.user_request}</p>
        </section>

        {plan.plan_summary && (
          <section className="space-y-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Summary</div>
            <p className="text-sm whitespace-pre-wrap break-words">{plan.plan_summary}</p>
          </section>
        )}

        <section className="space-y-2 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Steps</div>
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="rounded-md border border-border bg-card/40 p-2 text-sm min-w-0">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="break-words">{s.description}</div>
                    <div className={`mt-0.5 text-xs ${STEP_STATUS_COLOR[s.status] ?? "text-muted-foreground"}`}>
                      {s.status ?? "pending"}
                    </div>
                    {s.status === "completed" && s.result != null && (
                      <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[10px] text-muted-foreground">
                        {JSON.stringify(s.result, null, 2).slice(0, 400)}
                      </pre>
                    )}
                    {s.status === "failed" && s.error && (
                      <div className="mt-1 text-xs text-red-400 whitespace-pre-wrap break-all">{s.error}</div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {plan.status === "failed" && (
          <section className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 min-w-0">
            <div className="text-xs uppercase tracking-wider text-destructive">What went wrong</div>
            <p className="text-sm whitespace-pre-wrap break-all">{plan.error_message}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={() => setRetryOpen(true)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Fix &amp; retry from this step
              </button>
              {plan.error_lovable_prompt && (
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(plan.error_lovable_prompt ?? "");
                    if (ok) toast.success("Copied fix prompt to clipboard");
                    else toast.error("Failed to copy");
                  }}
                  className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Copy fix prompt for Lovable
                </button>
              )}
            </div>
          </section>
        )}

        {plan.status === "completed" && (
          <button
            onClick={() => toast("Run again — coming soon")}
            className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
          >
            Run again
          </button>
        )}
      </DialogContent>

      <PlanRetryDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        planId={planId}
        failedStepNumber={(plan.current_step ?? 0) + 1}
        totalSteps={plan.total_steps ?? steps.length}
        errorMessage={plan.error_message ?? null}
        onRetried={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

