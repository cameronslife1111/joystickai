// Is the signed-in account inside the tester lock (see feature-lock.ts)?
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureLocked } from "@/lib/feature-lock";

export function useFeatureLock(): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setLocked(isFeatureLocked(data.user?.created_at ?? null));
    });
    return () => {
      alive = false;
    };
  }, []);
  return locked;
}
