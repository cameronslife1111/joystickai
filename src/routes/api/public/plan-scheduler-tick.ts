import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nextRunAt, type ScheduleSpec, type Cadence } from "@/lib/recurrence";

// Fairness + safety caps.
const MAX_SCHEDULES_PER_TICK = 20;
const MAX_FIRES_PER_USER_PER_TICK = 5;
const SPACING_MINUTES = 30;

function toSpec(s: any): ScheduleSpec {
  return {
    cadence: s.cadence as Cadence,
    interval_n: s.interval_n ?? 1,
    time_of_day: s.time_of_day ?? null,
    timezone: s.timezone ?? "UTC",
    weekdays: s.weekdays ?? [],
    month_days: s.month_days ?? [],
    year_month_days: s.year_month_days ?? [],
    starts_at: s.starts_at ?? null,
    ends_at: s.ends_at ?? null,
    max_runs: s.max_runs ?? null,
    run_count: s.run_count ?? 0,
  };
}

async function fireSchedule(
  schedule: any,
): Promise<{ id: string; outcome: string; plan_id?: string }> {
  const userId = schedule.user_id;

  // Spacing: bail if the user has any active plan with a scheduled_for inside
  // the +/- 30 min window. Bump next_run_at forward and skip this tick.
  const winStart = new Date(Date.now() - SPACING_MINUTES * 60_000).toISOString();
  const winEnd = new Date(Date.now() + SPACING_MINUTES * 60_000).toISOString();
  const { data: nearby } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("user_id", userId)
    .gte("scheduled_for", winStart)
    .lte("scheduled_for", winEnd)
    .not("status", "in", "(completed,failed,cancelled)")
    .limit(1);

  if (nearby && nearby.length > 0) {
    const bumped = new Date(Date.now() + SPACING_MINUTES * 60_000).toISOString();
    await supabaseAdmin
      .from("plan_schedules")
      .update({ next_run_at: bumped, claim_at: null })
      .eq("id", schedule.id);
    return { id: schedule.id, outcome: "deferred_spacing" };
  }

  // Create the plans row. Status starts as 'composing'; plan-compose flips it
  // to 'approved' on its own for scheduled plans (it reads schedule_id), so we
  // do NOT need to synchronously wait for compose here.
  const scheduledFor = schedule.next_run_at ?? new Date().toISOString();
  const { data: plan, error: pErr } = await supabaseAdmin
    .from("plans")
    .insert({
      user_id: userId,
      status: "composing",
      user_request: schedule.user_request,
      attached_document_ids: schedule.attached_document_ids ?? [],
      schedule_id: schedule.id,
      scheduled_for: scheduledFor,
    })
    .select()
    .single();

  if (pErr || !plan) {
    await supabaseAdmin
      .from("plan_schedules")
      .update({ claim_at: null })
      .eq("id", schedule.id);
    return { id: schedule.id, outcome: `insert_failed:${pErr?.message ?? "unknown"}` };
  }

  // Advance the schedule IMMEDIATELY — before the slow compose call — so a
  // compose timeout can never leave next_run_at stuck in the past and cause
  // the schedule to re-fire every stale-claim window.
  const newRunCount = (schedule.run_count ?? 0) + 1;
  const advancedSpec: ScheduleSpec = { ...toSpec(schedule), run_count: newRunCount };
  const next = nextRunAt(advancedSpec);
  await supabaseAdmin
    .from("plan_schedules")
    .update({
      next_run_at: next ? next.toISOString() : null,
      enabled: next ? schedule.enabled : false,
      claim_at: null,
      last_run_at: new Date().toISOString(),
      last_plan_id: plan.id,
      run_count: newRunCount,
    })
    .eq("id", schedule.id);

  // Fire-and-forget the composer. plan-compose auto-approves scheduled plans,
  // and the plan-tick cron executes the steps once approved. We pass
  // internal_secret + body.user_id so the function accepts the service-role call.
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET!;
  void fetch(`${SUPABASE_URL}/functions/v1/plan-compose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      plan_id: plan.id,
      user_id: userId,
      internal_secret: PLAN_TICK_SECRET,
    }),
  }).catch((err) => console.error("plan-compose invocation failed", err));

  return { id: schedule.id, outcome: "fired", plan_id: plan.id };
}

export const Route = createFileRoute("/api/public/plan-scheduler-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anonKey =
          process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const sentKey =
          request.headers.get("apikey") ?? request.headers.get("Apikey");
        const sentSecret = request.headers.get("x-plan-tick-secret");
        const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET;
        const authed =
          (anonKey && sentKey === anonKey) ||
          (PLAN_TICK_SECRET && sentSecret === PLAN_TICK_SECRET);
        if (!authed) return new Response("unauthorized", { status: 401 });

        const { data: due, error } = await supabaseAdmin
          .from("plan_schedules")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", new Date().toISOString())
          .or(`claim_at.is.null,claim_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
          .order("next_run_at", { ascending: true })
          .limit(MAX_SCHEDULES_PER_TICK * 3);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Fairness cap.
        const perUser = new Map<string, number>();
        const picked: any[] = [];
        for (const s of due ?? []) {
          const used = perUser.get(s.user_id) ?? 0;
          if (used >= MAX_FIRES_PER_USER_PER_TICK) continue;
          perUser.set(s.user_id, used + 1);
          picked.push(s);
          if (picked.length >= MAX_SCHEDULES_PER_TICK) break;
        }

        // Claim atomically + fire in parallel.
        const results = await Promise.all(
          picked.map(async (s) => {
            const { data: claimed, error: claimErr } = await supabaseAdmin
              .rpc("claim_due_schedule", { p_id: s.id })
              .single();
            if (claimErr || !claimed) {
              return { id: s.id, outcome: "not_claimed" };
            }
            try {
              return await fireSchedule(claimed);
            } catch (err) {
              await supabaseAdmin
                .from("plan_schedules")
                .update({ claim_at: null })
                .eq("id", s.id);
              return {
                id: s.id,
                outcome: `error:${String((err as any)?.message ?? err)}`,
              };
            }
          }),
        );

        return Response.json({
          ok: true,
          considered: due?.length ?? 0,
          fired: results.filter((r) => r.outcome === "fired").length,
          results,
        });
      },
      GET: async () => {
        const { count } = await supabaseAdmin
          .from("plan_schedules")
          .select("id", { count: "exact", head: true })
          .eq("enabled", true);
        return Response.json({ ok: true, enabled_schedules: count ?? 0 });
      },
    },
  },
});
