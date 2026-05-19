import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanDetailDialog } from "./PlanDetailDialog";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success("Copied request");
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const { data: plans } = useQuery({
    queryKey: ["plans"],
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
      { title: "Running", items: all.filter((p) => p.status === "approved" || p.status === "running") },
      { title: "Failed", items: all.filter((p) => p.status === "failed") },
      { title: "Cancelled", items: all.filter((p) => p.status === "cancelled") },
      { title: "Completed", items: all.filter((p) => p.status === "completed") },
    ];
  }, [plans]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">AI Plans</h1>
        <button onClick={onClose} className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {sections.map((sec) => (
          <section key={sec.title}>
            <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              {sec.title} ({sec.items.length})
            </h2>
            {sec.items.length === 0 ? (
              <div className="text-xs text-muted-foreground/60">None</div>
            ) : (
              <ul className="space-y-2">
                {sec.items.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setOpenId(p.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/40"
                    >
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${STATUS_COLOR[p.status] ?? "bg-muted"}`}>
                        {p.status}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{p.user_request.slice(0, 80)}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {p.current_step}/{p.total_steps} · {timeAgo(p.created_at)}
                        </div>
                      </div>
                      <span className="text-muted-foreground">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <PlanDetailDialog planId={openId} open={!!openId} onOpenChange={(v: boolean) => { if (!v) setOpenId(null); }} />
    </div>
  );
}
