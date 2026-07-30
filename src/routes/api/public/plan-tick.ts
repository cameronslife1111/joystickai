import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Per-tick limits. Keep small so one tick stays well under the 30s edge timeout.
const MAX_PLANS_PER_TICK = 8;
const MAX_PLANS_PER_USER = 2;
const STALE_CLAIM_MS = 90_000;

// Composing watchdog: a plan that has sat in "composing" this long without
// becoming approved is considered stalled and gets re-composed.
const COMPOSE_STALE_MS = 120_000;
const MAX_COMPOSE_PER_TICK = 3;
const MAX_COMPOSE_ATTEMPTS = 3;

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

// Re-run plan-compose for a plan whose composing call never finished (e.g. the
// worker that kicked it off was torn down). Claim-guarded so parallel ticks
// don't compose the same plan twice.
async function recomposePlan(plan: { id: string; user_id: string; compose_attempts: number | null }) {
  const attempts = plan.compose_attempts ?? 0;

  if (attempts >= MAX_COMPOSE_ATTEMPTS) {
    await supabaseAdmin
      .from("plans")
      .update({
        status: "failed",
        error_message:
          "Planning timed out — the planner didn't respond after several attempts. Tap Fix & Retry to try again.",
        compose_claim_at: null,
      })
      .eq("id", plan.id)
      .eq("status", "composing");
    return { plan_id: plan.id, outcome: "gave_up" };
  }

  // Atomic-ish claim: only proceed if we successfully stamp a fresh claim on a
  // row that still looks stale.
  const staleCutoff = new Date(Date.now() - COMPOSE_STALE_MS).toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("plans")
    .update({
      compose_claim_at: new Date().toISOString(),
      compose_attempts: attempts + 1,
    })
    .eq("id", plan.id)
    .eq("status", "composing")
    .or(`compose_claim_at.is.null,compose_claim_at.lt.${staleCutoff}`)
    .select("id")
    .maybeSingle();

  if (!claimed) return { plan_id: plan.id, outcome: "not_claimed" };

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET!;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/plan-compose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        plan_id: plan.id,
        user_id: plan.user_id,
        internal_secret: PLAN_TICK_SECRET,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    return { plan_id: plan.id, outcome: `recomposed:${res.status}` };
  } catch (err) {
    return { plan_id: plan.id, outcome: `recompose_error:${String((err as any)?.message ?? err)}` };
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

        // Second pass: plans stuck in "composing" (the composer call died or
        // never ran). This is what makes scheduled plans complete with the web
        // app closed.
        const composeCutoff = new Date(Date.now() - COMPOSE_STALE_MS).toISOString();
        const { data: stalledComposing } = await supabaseAdmin
          .from("plans")
          .select("id, user_id, compose_attempts")
          .eq("status", "composing")
          .lt("created_at", composeCutoff)
          .or(`compose_claim_at.is.null,compose_claim_at.lt.${composeCutoff}`)
          .order("created_at", { ascending: true })
          .limit(MAX_COMPOSE_PER_TICK);

        // Advance plans in parallel — each call has its own atomic claim guard.
        const [results, composeResults] = await Promise.all([
          Promise.all(picked.map((p) => advancePlan(p.id, p.user_id))),
          Promise.all((stalledComposing ?? []).map((p) => recomposePlan(p as any))),
        ]);

        return Response.json({
          ok: true,
          considered: candidates?.length ?? 0,
          advanced: picked.length,
          results,
          recomposed: composeResults,
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
