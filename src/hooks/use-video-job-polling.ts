import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 5000;

export function useVideoJobPolling(userId: string | undefined | null) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Set<string>>(new Set());
  const completedNotified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const tick = async () => {
      const { data: rows } = await supabase
        .from("media_assets")
        .select("id, kind")
        .eq("user_id", userId)
        .eq("status", "generating")
        .not("fal_status_url", "is", null);

      if (!rows || rows.length === 0) return;

      await Promise.all(
        rows.map(async (row) => {
          if (inFlight.current.has(row.id)) return;
          inFlight.current.add(row.id);
          try {
            const { data, error } = await supabase.functions.invoke("poll-video-job", {
              body: { row_id: row.id },
            });
            if (error) return;
            if (data?.status === "COMPLETED" && !completedNotified.current.has(row.id)) {
              completedNotified.current.add(row.id);
              toast.success("Your video is ready");
              queryClient.invalidateQueries({ queryKey: ["media_assets"] });
            }
            if (data?.status === "FAILED" && !completedNotified.current.has(row.id)) {
              completedNotified.current.add(row.id);
              toast.error(`Video generation failed: ${data.error ?? "Unknown error"}`);
              queryClient.invalidateQueries({ queryKey: ["media_assets"] });
            }
          } finally {
            inFlight.current.delete(row.id);
          }
        }),
      );
    };

    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [userId, queryClient]);
}
