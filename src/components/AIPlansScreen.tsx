import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlanDetailDialog } from "./PlanDetailDialog";
import { PlanApprovalDialog } from "./PlanApprovalDialog";
import { ScheduledPlansList } from "./plan/ScheduledPlansList";

interface Props {
  onClose: () => void;
}

type Plan = {
  id: string;
  status: string;
  user_request: string;
  current_step: number;
  total_steps: number;
  created_at: string;
  acknowledged: boolean;
  schedule_id: string | null;
  scheduled_for: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  approved: "bg-blue-500/20 text-blue-300",
  running: "bg-blue-500/20 text-blue-300",
  awaiting_media: "bg-blue-500/20 text-blue-300",
  retrying: "bg-blue-500/20 text-blue-300",
  completed: "bg-green-500/20 text-green-300",
  failed: "bg-red-500/20 text-red-300",
  cancelled: "bg-muted text-muted-foreground",
  composing: "bg-muted text-muted-foreground",
  proposed: "bg-yellow-500/20 text-yellow-300",
};

const ACTIVE_STATUSES = new Set(["proposed", "composing", "approved", "running", "awaiting_media", "retrying"]);
const HISTORY_STATUSES = new Set(["completed", "failed", "cancelled"]);

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function AIPlansScreen({ onClose }: Props) {
  const qc = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "scheduled" | "history">("active");

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    refetchInterval: 3000,
    queryFn: async (): Promise<Plan[]> => {
      const { data } = await supabase
        .from("plans")
        .select("id, status, user_request, current_step, total_steps, created_at, acknowledged, schedule_id, scheduled_for")
        .order("created_at", { ascending: false });
      return (data as any) ?? [];
    },
  });

  // Mark all unacknowledged completed/failed as acknowledged on mount.
  useEffect(() => {
    (async () => {
      await supabase
        .from("plans")
        .update({ acknowledged: true })
        .eq("acknowledged", false)
        .in("status", ["completed", "failed"]);
      qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
    })();
  }, [qc]);

  const active = useMemo(() => (plans ?? []).filter((p) => ACTIVE_STATUSES.has(p.status)), [plans]);
  const history = useMemo(() => (plans ?? []).filter((p) => HISTORY_STATUSES.has(p.status)), [plans]);

  const handleRowClick = (p: Plan) => {
    if (p.status === "proposed" || p.status === "composing") {
      setApprovalId(p.id);
    } else {
      setDetailId(p.id);
    }
  };

  const clearHistory = async (status: string) => {
    if (!confirm(`Delete all ${status} plans? This can't be undone.`)) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { error } = await supabase
      .from("plans")
      .delete()
      .eq("user_id", uid)
      .eq("status", status);
    if (error) { toast.error(`Couldn't clear: ${error.message}`); return; }
    toast.success(`Cleared ${status} plans`);
    qc.invalidateQueries({ queryKey: ["plans"] });
    qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
  };

  const cancelPlan = async (planId: string) => {
    if (!confirm("Stop this plan? It can't be resumed.")) return;
    const { error } = await supabase.from("plans").update({ status: "cancelled" }).eq("id", planId);
    if (error) { toast.error(`Couldn't stop: ${error.message}`); return; }
    toast.success("Plan stopped");
    qc.invalidateQueries({ queryKey: ["plans"] });
    qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
  };

  const renderRow = (p: Plan) => {
    const stoppable = ACTIVE_STATUSES.has(p.status) && p.status !== "proposed" && p.status !== "composing";
    return (
    <li key={p.id}>
      <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-card pr-2 hover:bg-muted/40">
      <button
        onClick={() => handleRowClick(p)}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${STATUS_COLOR[p.status] ?? "bg-muted"}`}>
          {p.status === "awaiting_media" ? "media" : p.status}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">
            {p.user_request.slice(0, 120)}
            {p.schedule_id && (
              <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                scheduled
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {p.status === "proposed"
              ? "Tap to review"
              : p.status === "retrying"
                ? "Repairing…"
                : `${p.current_step}/${p.total_steps} · ${timeAgo(p.created_at)}`}
          </div>
        </div>
      </button>
      {stoppable ? (
        <button
          onClick={() => cancelPlan(p.id)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
        >
          Stop
        </button>
      ) : (
        <span className="shrink-0 pr-1 text-muted-foreground">›</span>
      )}
      </div>
    </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-3 py-3 sm:px-4">
        <h1 className="text-lg font-semibold">AI Plans</h1>
        <button onClick={onClose} className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex flex-1 min-h-0 flex-col">
        <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 sm:px-4">
          <TabsContent value="active" className="mt-0">
            {active.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Nothing running right now.
              </div>
            ) : (
              <ul className="space-y-2">{active.map(renderRow)}</ul>
            )}
          </TabsContent>

          <TabsContent value="scheduled" className="mt-0">
            <ScheduledPlansList />
          </TabsContent>

          <TabsContent value="history" className="mt-0 space-y-4">
            {(["completed", "failed", "cancelled"] as const).map((status) => {
              const items = history.filter((p) => p.status === status);
              return (
                <section key={status}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
                      {status} ({items.length})
                    </h2>
                    {items.length > 0 && (
                      <button
                        onClick={() => clearHistory(status)}
                        className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  {items.length === 0 ? (
                    <div className="text-xs text-muted-foreground/60">None</div>
                  ) : (
                    <ul className="space-y-2">{items.map(renderRow)}</ul>
                  )}
                </section>
              );
            })}
          </TabsContent>
        </div>
      </Tabs>

      <PlanDetailDialog planId={detailId} open={!!detailId} onOpenChange={(v: boolean) => { if (!v) setDetailId(null); }} />
      <PlanApprovalDialog
        planId={approvalId}
        open={!!approvalId}
        onOpenChange={(v: boolean) => { if (!v) setApprovalId(null); }}
      />

      {/* Back to Orby — floating bottom-left */}
      <button
        onClick={onClose}
        aria-label="Back to Orby"
        className="fixed left-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-foreground/10 bg-card/90 text-foreground shadow-lg backdrop-blur transition active:scale-95 hover:bg-foreground/10"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
    </div>
  );
}
