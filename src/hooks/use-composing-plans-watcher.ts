import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const TICK_MS = 1500;

/**
 * Watches the current user's `composing` plans in the background. When one
 * transitions to `proposed` with steps, it is auto-approved and kicked off
 * immediately — no user action required. A "Plan started" toast confirms it,
 * with an optional "View" action (calls `onViewPlan`). Refusals (proposed with
 * no steps) and failures fire a toast that opens the plan for review
 * (`onReviewPlan`).
 */
export function useComposingPlansWatcher(
  userId: string | undefined | null,
  onViewPlan: (planId: string) => void,
  onReviewPlan: (planId: string) => void,
) {
  const qc = useQueryClient();
  const tracking = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());
  const viewRef = useRef(onViewPlan);
  const reviewRef = useRef(onReviewPlan);
  viewRef.current = onViewPlan;
  reviewRef.current = onReviewPlan;

  useEffect(() => {
    if (!userId) return;
    let stopped = false;

    const tick = async () => {
      const { data: composing } = await supabase
        .from("plans")
        .select("id, status")
        .eq("user_id", userId)
        .eq("status", "composing");
      for (const row of composing ?? []) tracking.current.add(row.id);

      if (tracking.current.size === 0) return;
      const ids = Array.from(tracking.current);
      const { data: rows } = await supabase
        .from("plans")
        .select("id, status, steps")
        .in("id", ids);

      const { toast } = await import("sonner");
      for (const row of rows ?? []) {
        if (row.status === "composing") continue;
        tracking.current.delete(row.id);
        if (notified.current.has(row.id)) continue;
        notified.current.add(row.id);

        const steps = Array.isArray((row as any).steps) ? (row as any).steps : [];

        if (row.status === "proposed" && steps.length > 0) {
          // Real proposal → auto-approve and run immediately.
          await supabase
            .from("plans")
            .update({ status: "approved", approved_at: new Date().toISOString() })
            .eq("id", row.id);
          void supabase.functions.invoke("plan-step", { body: { plan_id: row.id } });
          toast.success("Plan started — running in the background", {
            duration: 6000,
            action: { label: "View", onClick: () => viewRef.current(row.id) },
          });
          qc.invalidateQueries({ queryKey: ["plans"] });
          qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
          continue;
        }

        if (row.status === "proposed" || row.status === "failed") {
          // Refusal (no steps) or failure → let the user review the details.
          const isFail = row.status === "failed";
          (isFail ? toast.error : toast)(
            isFail ? "Planning failed — tap for details" : "Couldn't plan that — tap to review",
            {
              duration: Infinity,
              action: { label: isFail ? "Details" : "Review", onClick: () => reviewRef.current(row.id) },
            },
          );
          qc.invalidateQueries({ queryKey: ["plans"] });
        }
      }
    };

    tick();
    const id = window.setInterval(() => { if (!stopped) tick(); }, TICK_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, [userId, qc]);
}
