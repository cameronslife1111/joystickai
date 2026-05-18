import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const TICK_MS = 2000;

export function useRunningPlansAdvancer(
  userId: string | undefined | null,
  onCompleted: (planId: string) => void,
  onFailed: (planId: string) => void,
) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());
  const completedCb = useRef(onCompleted);
  const failedCb = useRef(onFailed);
  completedCb.current = onCompleted;
  failedCb.current = onFailed;

  useEffect(() => {
    if (!userId) return;
    const tick = async () => {
      const { data: rows } = await supabase
        .from("plans")
        .select("id, status")
        .eq("user_id", userId)
        .in("status", ["approved", "running"]);
      for (const row of rows ?? []) {
        if (inFlight.current.has(row.id)) continue;
        inFlight.current.add(row.id);
        (async () => {
          try {
            const { data } = await supabase.functions.invoke("plan-step", { body: { plan_id: row.id } });
            if (data?.status === "completed" && !notified.current.has(row.id)) {
              notified.current.add(row.id);
              completedCb.current(row.id);
              queryClient.invalidateQueries({ queryKey: ["plans"] });
              queryClient.invalidateQueries({ queryKey: ["plans_pending_count"] });
              queryClient.invalidateQueries({ queryKey: ["documents"] });
            }
            if (data?.status === "failed" && !notified.current.has(row.id)) {
              notified.current.add(row.id);
              failedCb.current(row.id);
              queryClient.invalidateQueries({ queryKey: ["plans"] });
              queryClient.invalidateQueries({ queryKey: ["plans_pending_count"] });
            }
          } finally {
            inFlight.current.delete(row.id);
          }
        })();
      }
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [userId, queryClient]);
}
