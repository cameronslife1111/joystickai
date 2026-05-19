import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string | null;
  onApproved?: () => void;
}

export function PlanApprovalDialog({ open, onOpenChange, planId, onApproved }: Props) {
  const qc = useQueryClient();

  const { data: plan, refetch } = useQuery({
    queryKey: ["plan", planId],
    enabled: !!planId && open,
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.status;
      return s === "composing" ? 1000 : false;
    },
    queryFn: async () => {
      if (!planId) return null;
      const { data } = await supabase.from("plans").select("*").eq("id", planId).single();
      return data;
    },
  });

  // Realtime subscription for this plan
  useEffect(() => {
    if (!planId || !open) return;
    const ch = supabase
      .channel(`plan_${planId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "plans", filter: `id=eq.${planId}` }, () => {
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [planId, open, refetch]);

  const cancel = async () => {
    if (planId) {
      await supabase.from("plans").update({ status: "cancelled" }).eq("id", planId);
      qc.invalidateQueries({ queryKey: ["plans"] });
    }
    onOpenChange(false);
  };

  const approve = async () => {
    if (!planId) return;
    await supabase.from("plans").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", planId);
    onOpenChange(false);
    void supabase.functions.invoke("plan-step", { body: { plan_id: planId } });
    qc.invalidateQueries({ queryKey: ["plans"] });
    toast.success("Plan running in the background");
    onApproved?.();
  };

  const status = plan?.status;
  const steps: any[] = Array.isArray(plan?.steps) ? plan.steps : [];
  const refused = status === "proposed" && steps.length === 0;
  const failed = status === "failed";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onOpenChange(false); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto break-words">
        <DialogHeader>
          <DialogTitle>Review the plan</DialogTitle>
        </DialogHeader>

        {(!plan || status === "composing") && (
          <div className="py-8 text-center text-sm text-muted-foreground">Planning…</div>
        )}

        {failed && (
          <div className="space-y-2">
            <div className="text-sm text-destructive">Planning failed.</div>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{plan?.error_message}</div>
          </div>
        )}

        {refused && (
          <div className="space-y-2">
            <div className="text-sm">I can't do that as described.</div>
            {plan?.plan_summary && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{plan.plan_summary}</div>
            )}
          </div>
        )}

        {status === "proposed" && steps.length > 0 && (
          <div className="space-y-3">
            {plan?.plan_summary && <p className="text-sm">{plan.plan_summary}</p>}
            <ol className="space-y-2 text-sm">
              {steps.map((s: any, i: number) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{s.description}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={cancel} className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            {refused || failed ? "Close" : "Cancel"}
          </button>
          {status === "proposed" && steps.length > 0 && (
            <button onClick={approve} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Approve and Run
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
