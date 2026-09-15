// Server-only companion to feature-lock.ts: works out whether the account that
// owns a piece of work signed up after the tester cutoff.
import { isFeatureLocked } from "@/lib/feature-lock";

const cache = new Map<string, { locked: boolean; at: number }>();
const TTL_MS = 5 * 60_000;

export async function isUserFeatureLocked(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.locked;
  let locked = false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    locked = isFeatureLocked(data?.user?.created_at ?? null);
  } catch {
    locked = false; // never block existing users because of a lookup hiccup
  }
  cache.set(userId, { locked, at: Date.now() });
  return locked;
}
