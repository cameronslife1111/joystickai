import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const TICK_MS = 1500;

/**
 * Watches the current user's `composing` plans in the background. When one
 * transitions to `proposed` or `failed`, fires a toast with an action that
 * opens the approval dialog for that plan. This lets the composer dialog
 * close immediately on submit so the user isn't blocked while Orby thinks.
 */
export function useComposingPlansWatcher(
  userId: string | undefined | null,
  onOpenPlan: (planId: string) => void,
) {
  const qc = useQueryClient();
  const tracking = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());
  const cbRef = useRef(onOpenPlan);
  cbRef.current = onOpenPlan;

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
        .select("id, status")
        .in("id", ids);

      const { toast } = await import("sonner");
      for (const row of rows ?? []) {
        if (row.status === "composing") continue;
        tracking.current.delete(row.id);
        if (notified.current.has(row.id)) continue;
        notified.current.add(row.id);
        if (row.status === "proposed" || row.status === "failed") {
          const isFail = row.status === "failed";
          (isFail ? toast.error : toast)(
            isFail ? "Planning failed — tap for details" : "Plan ready — tap to review",
            {
              // Persist until the user dismisses or acts — they shouldn't miss it.
              duration: Infinity,
              action: { label: isFail ? "Details" : "Review", onClick: () => cbRef.current(row.id) },
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
