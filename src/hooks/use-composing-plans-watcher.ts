import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const TICK_MS = 1500;

/**
 * Watches the current user's `composing` plans in the background. Nothing the
 * user started is ever auto-approved: a plan that finishes composing waits for
 * approval, and the toast opens it for review (`onReviewPlan`). The only plans
 * that arrive already `approved` are scheduled runs and replans the user
 * already approved with notes — those are kicked off here and confirmed with a
 * "Plan started" toast (`onViewPlan`). Plans flagged `review_in_chat` are
 * reviewed inside their chat card, so they are skipped entirely.
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
        .select("id, status, steps, review_in_chat")
        .in("id", ids);

      const { toast } = await import("sonner");
      for (const row of rows ?? []) {
        if (row.status === "composing") continue;
        tracking.current.delete(row.id);
        if (notified.current.has(row.id)) continue;
        notified.current.add(row.id);

        const steps = Array.isArray((row as any).steps) ? (row as any).steps : [];
        const inChat = !!(row as any).review_in_chat;

        if (row.status === "approved") {
          // Already approved by the user (or a schedule) → start it.
          void supabase.functions.invoke("plan-step", { body: { plan_id: row.id } });
          toast.success("Plan started — running in the background", {
            duration: 6000,
            action: { label: "View", onClick: () => viewRef.current(row.id) },
          });
          qc.invalidateQueries({ queryKey: ["plans"] });
          qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
          continue;
        }

        if (inChat) continue; // reviewed inside its chat card

        if (row.status === "proposed" || row.status === "failed") {
          // Waiting for approval, a refusal, or a failure → open for review.
          const isFail = row.status === "failed";
          const refused = row.status === "proposed" && steps.length === 0;
          (isFail ? toast.error : toast)(
            isFail
              ? "Planning failed — tap for details"
              : refused
                ? "Couldn't plan that — tap to review"
                : "Plan ready — tap to approve it",
            {
              duration: Infinity,
              action: {
                label: isFail ? "Details" : refused ? "Review" : "Approve",
                onClick: () => reviewRef.current(row.id),
              },
            },
          );
          qc.invalidateQueries({ queryKey: ["plans"] });
          qc.invalidateQueries({ queryKey: ["plans_pending_count"] });
        }
      }
    };

    tick();
    const id = window.setInterval(() => { if (!stopped) tick(); }, TICK_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, [userId, qc]);
}
