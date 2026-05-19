import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlanDetailDialog } from "./PlanDetailDialog";
import { PlanApprovalDialog } from "./PlanApprovalDialog";

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
};

const STATUS_COLOR: Record<string, string> = {
  approved: "bg-blue-500/20 text-blue-300",
  running: "bg-blue-500/20 text-blue-300",
  awaiting_media: "bg-blue-500/20 text-blue-300",
  completed: "bg-green-500/20 text-green-300",
  failed: "bg-red-500/20 text-red-300",
  cancelled: "bg-muted text-muted-foreground",
  composing: "bg-muted text-muted-foreground",
  proposed: "bg-yellow-500/20 text-yellow-300",
};

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

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    refetchInterval: 3000,
    queryFn: async (): Promise<Plan[]> => {
      const { data } = await supabase
        .from("plans")
        .select("id, status, user_request, current_step, total_steps, created_at, acknowledged")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Mark all unacknowledged completed/failed as acknowledged on mount
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

  const sections = useMemo(() => {
    const all = plans ?? [];
    return [
      {
        key: "proposed",
        title: "Awaiting approval",
        items: all.filter((p) => p.status === "proposed"),
        clearable: false,
      },
      {
        key: "composing",
        title: "Planning",
        items: all.filter((p) => p.status === "composing"),
        clearable: false,
      },
      {
        key: "running",
        title: "Running",
        items: all.filter((p) => p.status === "approved" || p.status === "running" || p.status === "awaiting_media"),
        clearable: false,
      },
      { key: "failed", title: "Failed", items: all.filter((p) => p.status === "failed"), clearable: true },
      { key: "cancelled", title: "Cancelled", items: all.filter((p) => p.status === "cancelled"), clearable: true },
      { key: "completed", title: "Completed", items: all.filter((p) => p.status === "completed"), clearable: true },
    ];
  }, [plans]);

  const handleRowClick = (p: Plan) => {
    if (p.status === "proposed" || p.status === "composing") {
      setApprovalId(p.id);
    } else {
      setDetailId(p.id);
    }
  };

  const handleClearSection = async (sectionKey: string, statusValues: string[], label: string) => {
    if (!confirm(`Delete all ${label} plans? This can't be undone.`)) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { error } = await supabase
      .from("plans")
      .delete()
      .eq("user_id", uid)
      .in("status", statusValues);
    if (error) {
      toast.error(`Couldn't clear: ${error.message}`);
      return;
    }
    toast.success(`Cleared ${label} plans`);
    qc.invalidateQueries({ queryKey: ["plans"] });
    qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-3 py-3 sm:px-4">
        <h1 className="text-lg font-semibold">AI Plans</h1>
        <button onClick={onClose} className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </header>
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 space-y-6 sm:px-4">
        {sections.map((sec) => (
          <section key={sec.key}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
                {sec.title} ({sec.items.length})
              </h2>
              {sec.clearable && sec.items.length > 0 && (
                <button
                  onClick={() => handleClearSection(sec.key, [sec.key], sec.title.toLowerCase())}
                  className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Clear all
                </button>
              )}
            </div>
            {sec.items.length === 0 ? (
              <div className="text-xs text-muted-foreground/60">None</div>
            ) : (
              <ul className="space-y-2">
                {sec.items.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => handleRowClick(p)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/40"
                    >
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${STATUS_COLOR[p.status] ?? "bg-muted"}`}>
                        {p.status === "awaiting_media" ? "media" : p.status}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{p.user_request.slice(0, 120)}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {p.status === "proposed"
                            ? "Tap to review"
                            : `${p.current_step}/${p.total_steps} · ${timeAgo(p.created_at)}`}
                        </div>
                      </div>
                      <span className="shrink-0 text-muted-foreground">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <PlanDetailDialog planId={detailId} open={!!detailId} onOpenChange={(v: boolean) => { if (!v) setDetailId(null); }} />
      <PlanApprovalDialog
        planId={approvalId}
        open={!!approvalId}
        onOpenChange={(v: boolean) => { if (!v) setApprovalId(null); }}
      />
    </div>
  );
}
