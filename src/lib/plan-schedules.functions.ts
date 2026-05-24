import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { nextRunAt, nextNRuns, type ScheduleSpec, type Cadence } from "@/lib/recurrence";

const cadenceEnum = z.enum(["once", "hourly", "daily", "weekly", "monthly", "yearly"]);

const scheduleInputSchema = z.object({
  title: z.string().min(1).max(120),
  user_request: z.string().min(1).max(8000),
  attached_document_ids: z.array(z.string().uuid()).max(10).default([]),
  cadence: cadenceEnum,
  interval_n: z.number().int().min(1).max(365).default(1),
  time_of_day: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  timezone: z.string().min(1).max(64),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  month_days: z.array(z.number().int().min(1).max(31)).max(31).default([]),
  year_month_days: z
    .array(z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }))
    .max(24)
    .default([]),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  max_runs: z.number().int().min(1).max(10000).nullable().optional(),
});

type ScheduleInput = z.infer<typeof scheduleInputSchema>;

const MAX_SCHEDULES_PER_USER = 50;

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

export const listSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("plan_schedules")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { schedules: data ?? [] };
  });

export const createSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => scheduleInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Cap active schedules per user.
    const { count, error: countErr } = await supabase
      .from("plan_schedules")
      .select("id", { count: "exact", head: true });
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) >= MAX_SCHEDULES_PER_USER) {
      throw new Error(`You've hit the limit of ${MAX_SCHEDULES_PER_USER} schedules. Delete one first.`);
    }

    const spec: ScheduleSpec = { ...toSpec(data), run_count: 0 };
    const computed = nextRunAt(spec);
    if (!computed) {
      throw new Error("That schedule has no future fire time — pick a future date or different cadence.");
    }

    const insert: any = {
      ...data,
      user_id: userId,
      enabled: true,
      next_run_at: computed.toISOString(),
      run_count: 0,
    };

    const { data: row, error } = await supabase
      .from("plan_schedules")
      .insert(insert)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { schedule: row };
  });

export const updateSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      id: z.string().uuid(),
      patch: scheduleInputSchema.partial(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Fetch current row so we can recompute next_run_at on any cadence change.
    const { data: existing, error: getErr } = await supabase
      .from("plan_schedules")
      .select("*")
      .eq("id", data.id)
      .single();
    if (getErr || !existing) throw new Error(getErr?.message || "Schedule not found");

    const merged = { ...existing, ...data.patch };
    const spec = toSpec(merged);
    const next = nextRunAt(spec);

    const { data: row, error } = await supabase
      .from("plan_schedules")
      .update({
        ...data.patch,
        next_run_at: next ? next.toISOString() : null,
        enabled: next ? (data.patch.enabled ?? existing.enabled ?? true) : false,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { schedule: row };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("plan_schedules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // When re-enabling, recompute next_run_at from now so we don't fire a backlog.
    const { data: existing } = await supabase
      .from("plan_schedules")
      .select("*")
      .eq("id", data.id)
      .single();
    if (!existing) throw new Error("Schedule not found");
    const patch: any = { enabled: data.enabled };
    if (data.enabled) {
      const next = nextRunAt(toSpec(existing));
      patch.next_run_at = next ? next.toISOString() : null;
      if (!next) patch.enabled = false;
    }
    const { data: row, error } = await supabase
      .from("plan_schedules")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { schedule: row };
  });

export const previewNextRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => scheduleInputSchema.parse(data))
  .handler(async ({ data }) => {
    const spec: ScheduleSpec = { ...toSpec(data), run_count: 0 };
    const runs = nextNRuns(spec, 5);
    return { runs: runs.map((d) => d.toISOString()) };
  });

export const runScheduleNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: schedule, error: sErr } = await supabase
      .from("plan_schedules")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sErr || !schedule) throw new Error(sErr?.message || "Schedule not found");

    // Spacing check: 30 min global window.
    const winStart = new Date(Date.now() - 30 * 60_000).toISOString();
    const winEnd = new Date(Date.now() + 30 * 60_000).toISOString();
    const { data: nearby } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId)
      .gte("scheduled_for", winStart)
      .lte("scheduled_for", winEnd)
      .not("status", "in", "(completed,failed,cancelled)")
      .limit(1);
    if (nearby && nearby.length > 0) {
      throw new Error("Another plan is scheduled within 30 minutes — try again later.");
    }

    const { data: plan, error: pErr } = await supabase
      .from("plans")
      .insert({
        user_id: userId,
        status: "composing",
        user_request: schedule.user_request,
        attached_document_ids: schedule.attached_document_ids ?? [],
        schedule_id: schedule.id,
        scheduled_for: new Date().toISOString(),
      })
      .select()
      .single();
    if (pErr || !plan) throw new Error(pErr?.message || "Failed to start plan");

    // Kick off composer; the existing plan-tick cron will execute steps.
    void supabase.functions.invoke("plan-compose", { body: { plan_id: plan.id } });

    await supabase
      .from("plan_schedules")
      .update({ last_plan_id: plan.id, last_run_at: new Date().toISOString() })
      .eq("id", schedule.id);

    return { plan_id: plan.id };
  });
