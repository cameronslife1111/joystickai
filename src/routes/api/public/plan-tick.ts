import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Per-tick limits. Keep small so one tick stays well under the 30s edge timeout.
const MAX_PLANS_PER_TICK = 8;
const MAX_PLANS_PER_USER = 2;
const STALE_CLAIM_MS = 90_000;

async function advancePlan(planId: string, userId: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET!;
  const url = `${SUPABASE_URL}/functions/v1/plan-step`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        plan_id: planId,
        user_id: userId,
        internal_secret: PLAN_TICK_SECRET,
      }),
    });
    const text = await res.text().catch(() => "");
    return { plan_id: planId, status: res.status, body: text.slice(0, 200) };
  } catch (err) {
    return { plan_id: planId, status: 0, error: String((err as any)?.message ?? err) };
  }
}

export const Route = createFileRoute("/api/public/plan-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: the request must come from pg_cron (carries the project anon
        // key in the apikey header) OR from a caller passing the shared
        // PLAN_TICK_SECRET. The anon key path lets the cron job stay simple;
        // the secret path lets ops trigger ticks manually.
        const anonKey =
          process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const sentKey =
          request.headers.get("apikey") ?? request.headers.get("Apikey");
        const sentSecret = request.headers.get("x-plan-tick-secret");
        const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET;
        const authed =
          (anonKey && sentKey === anonKey) ||
          (PLAN_TICK_SECRET && sentSecret === PLAN_TICK_SECRET);
        if (!authed) {
          return new Response("unauthorized", { status: 401 });
        }

        const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

        // Pick active plans whose claim is free OR stale (zombie claim from a
        // dead edge call). Order by oldest first for fairness.
        const { data: candidates, error } = await supabaseAdmin
          .from("plans")
          .select("id, user_id, status, step_claim_at")
          .in("status", ["approved", "running", "awaiting_media"])
          .or(`step_claim_at.is.null,step_claim_at.lt.${staleCutoff}`)
          .order("created_at", { ascending: true })
          .limit(MAX_PLANS_PER_TICK * 4);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Fairness cap: at most MAX_PLANS_PER_USER plans per user per tick.
        const perUser = new Map<string, number>();
        const picked: { id: string; user_id: string }[] = [];
        for (const c of candidates ?? []) {
          const used = perUser.get(c.user_id) ?? 0;
          if (used >= MAX_PLANS_PER_USER) continue;
          perUser.set(c.user_id, used + 1);
          picked.push({ id: c.id, user_id: c.user_id });
          if (picked.length >= MAX_PLANS_PER_TICK) break;
        }

        // Advance plans in parallel — each call has its own atomic claim guard.
        const results = await Promise.all(
          picked.map((p) => advancePlan(p.id, p.user_id)),
        );

        return Response.json({
          ok: true,
          considered: candidates?.length ?? 0,
          advanced: picked.length,
          results,
        });
      },
      // Allow GET for ad-hoc browser/health checks (returns counts only).
      GET: async () => {
        const { count: active } = await supabaseAdmin
          .from("plans")
          .select("id", { count: "exact", head: true })
          .in("status", ["approved", "running", "awaiting_media"]);
        return Response.json({ ok: true, active_plans: active ?? 0 });
      },
    },
  },
});
