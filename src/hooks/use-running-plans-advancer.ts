import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

// The server-side `/api/public/plan-tick` cron is the source of truth for
// advancing plans — it runs every 10s whether or not the app is open. These
// client-side ticks are a latency optimization: when a tab is open, advance
// faster so the user sees progress instantly. The atomic claim guard in
// plan-step prevents double execution if both fire at once.
const FAST_TICK_MS = 4000;
const SLOW_TICK_MS = 8000;

export function useRunningPlansAdvancer(
  userId: string | undefined | null,
  onCompleted: (planId: string) => void,
  onFailed: (planId: string) => void,
) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());
  // Per-plan last poll time, so awaiting_media plans only advance every SLOW_TICK_MS.
  const lastPolledAt = useRef<Map<string, number>>(new Map());
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
        .in("status", ["approved", "running", "awaiting_media"]);

      const now = Date.now();
      for (const row of rows ?? []) {
        if (inFlight.current.has(row.id)) continue;
        // Throttle media-waiting plans to the slow tick.
        if (row.status === "awaiting_media") {
          const last = lastPolledAt.current.get(row.id) ?? 0;
          if (now - last < SLOW_TICK_MS) continue;
        }
        inFlight.current.add(row.id);
        lastPolledAt.current.set(row.id, now);
        (async () => {
          try {
            const { data } = await supabase.functions.invoke("plan-step", { body: { plan_id: row.id } });
            if (data?.status === "completed" && !notified.current.has(row.id)) {
              notified.current.add(row.id);
              completedCb.current(row.id);
              queryClient.invalidateQueries({ queryKey: ["plans"] });
              queryClient.invalidateQueries({ queryKey: ["plans_pending_count"] });
              queryClient.invalidateQueries({ queryKey: ["documents"] });
              queryClient.invalidateQueries({ queryKey: ["media_assets"] });
            }
            if (data?.status === "failed" && !notified.current.has(row.id)) {
              notified.current.add(row.id);
              failedCb.current(row.id);
              queryClient.invalidateQueries({ queryKey: ["plans"] });
              queryClient.invalidateQueries({ queryKey: ["plans_pending_count"] });
            }
            if (data?.status === "awaiting_media") {
              // Surface the freshly-created (still-generating) asset to the gallery list,
              // so the user sees a placeholder card right away.
              queryClient.invalidateQueries({ queryKey: ["media_assets"] });
            }
          } finally {
            inFlight.current.delete(row.id);
          }
        })();
      }
    };
    tick();
    const id = window.setInterval(tick, FAST_TICK_MS);
    return () => window.clearInterval(id);
  }, [userId, queryClient]);
}
