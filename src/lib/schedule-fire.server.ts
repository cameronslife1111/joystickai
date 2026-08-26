// Server-only: fires a due schedule. Shared by the background scheduler tick
// and "Run now". Two flavours:
//   - plan schedule (no thread_id): create a plans row + compose, as before.
//   - chat schedule (thread_id set): post the user's message into that chat and
//     handle it exactly like a live send — plan, web search, or plain reply.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nextRunAt, type ScheduleSpec, type Cadence } from "@/lib/recurrence";
import { normalizeCapabilities, type ChatCapabilities } from "@/lib/chat-types";
import { runChatTurn } from "@/lib/chat-core.server";

const SPACING_MINUTES = 30;

/** Capability keys that map to plan tool groups (mirrors the chat client). */
const ACTION_TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
  "web_search",
];

export function toSpec(s: any): ScheduleSpec {
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

async function composePlan(planId: string, userId: string, allowedGroups: string[]) {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET!;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/plan-compose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        plan_id: planId,
        user_id: userId,
        allowed_tool_groups: allowedGroups.length ? allowedGroups : undefined,
        internal_secret: PLAN_TICK_SECRET,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error("plan-compose invocation failed", err);
  }
}

/** Advance next_run_at / run_count and release the claim. */
export async function advanceSchedule(schedule: any, planId: string | null) {
  const newRunCount = (schedule.run_count ?? 0) + 1;
  const next = nextRunAt({ ...toSpec(schedule), run_count: newRunCount });
  const patch: any = {
    next_run_at: next ? next.toISOString() : null,
    enabled: next ? schedule.enabled : false,
    claim_at: null,
    last_run_at: new Date().toISOString(),
    run_count: newRunCount,
  };
  if (planId) patch.last_plan_id = planId;
  await supabaseAdmin.from("plan_schedules").update(patch).eq("id", schedule.id);
}

/** True when another of the user's scheduled plans sits inside the spacing window. */
async function hasNearbyScheduledPlan(userId: string): Promise<boolean> {
  const winStart = new Date(Date.now() - SPACING_MINUTES * 60_000).toISOString();
  const winEnd = new Date(Date.now() + SPACING_MINUTES * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("user_id", userId)
    .gte("scheduled_for", winStart)
    .lte("scheduled_for", winEnd)
    .not("status", "in", "(completed,failed,cancelled)")
    .limit(1);
  return !!(data && data.length > 0);
}

async function insertChatMessage(
  userId: string,
  threadId: string,
  role: "user" | "assistant",
  content: string,
  kind: "text" | "plan" = "text",
  planId?: string,
) {
  await supabaseAdmin.from("chat_messages").insert({
    user_id: userId,
    thread_id: threadId,
    role,
    content,
    kind,
    ...(planId ? { plan_id: planId } : {}),
  });
  // Assistant activity arriving in the background makes the chat "unread" so it
  // surfaces at the top of the chats list with a blue dot.
  if (role === "assistant") {
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("chat_threads")
      .update({ last_assistant_at: now, updated_at: now })
      .eq("id", threadId);
  }
}

/**
 * Fire a chat-bound schedule: post the message in the thread, then run the same
 * turn a live send would run.
 */
async function fireChatSchedule(
  schedule: any,
): Promise<{ id: string; outcome: string; plan_id?: string }> {
  const userId = schedule.user_id;
  const threadId = schedule.thread_id as string;
  const text = (schedule.user_request ?? "").trim() || "(scheduled message)";

  // Confirm the thread still exists and belongs to this user.
  const { data: thread } = await supabaseAdmin
    .from("chat_threads")
    .select("id, attached_document_ids")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!thread) {
    await supabaseAdmin
      .from("plan_schedules")
      .update({ enabled: false, claim_at: null })
      .eq("id", schedule.id);
    return { id: schedule.id, outcome: "thread_missing" };
  }

  const caps = normalizeCapabilities(schedule.capabilities);
  const docIds: string[] =
    (schedule.attached_document_ids ?? []).length > 0
      ? schedule.attached_document_ids
      : (thread.attached_document_ids ?? []);
  const imageUrls: string[] = (schedule.image_urls ?? []).slice(0, 6);

  // Recent history so short scheduled follow-ups still make sense.
  const { data: rows } = await supabaseAdmin
    .from("chat_messages")
    .select("role, content, kind")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(400);
  const history = (rows ?? [])
    .slice(-40)
    .map((m: any) =>
      m.kind === "plan"
        ? { role: "assistant" as const, content: "[A plan was kicked off here and ran in the background.]" }
        : { role: m.role as "user" | "assistant", content: (m.content ?? "").slice(0, 20_000) },
    )
    .filter((m: any) => (m.content ?? "").trim().length > 0);

  // Post the user's scheduled message into the chat.
  await insertChatMessage(userId, threadId, "user", text);
  await supabaseAdmin
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  let result: { route: string; text?: string };
  try {
    result = await runChatTurn(supabaseAdmin, {
      messages: [...history, { role: "user" as const, content: text }],
      contextDocumentIds: docIds.slice(0, 20),
      imageUrls: caps.image_analysis ? imageUrls : [],
      threadId,
      capabilities: caps,
    } as any);
  } catch (err) {
    const msg = String((err as any)?.message ?? err);
    console.error("[schedule chat] turn failed", msg);
    await insertChatMessage(
      userId,
      threadId,
      "assistant",
      "Your scheduled message ran into a problem: " + msg,
    );
    await advanceSchedule(schedule, null);
    return { id: schedule.id, outcome: `chat_failed:${msg}` };
  }

  if (result.route === "plan") {
    if (await hasNearbyScheduledPlan(userId)) {
      const bumped = new Date(Date.now() + SPACING_MINUTES * 60_000).toISOString();
      await supabaseAdmin
        .from("plan_schedules")
        .update({ next_run_at: bumped, claim_at: null })
        .eq("id", schedule.id);
      await insertChatMessage(
        userId,
        threadId,
        "assistant",
        "Another plan is running right now, so I'll start this one shortly.",
      );
      return { id: schedule.id, outcome: "deferred_spacing" };
    }

    const { data: plan, error: pErr } = await supabaseAdmin
      .from("plans")
      .insert({
        user_id: userId,
        status: "composing",
        user_request: text,
        attached_document_ids: docIds,
        thread_id: threadId,
        schedule_id: schedule.id,
        scheduled_for: schedule.next_run_at ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (pErr || !plan) {
      await supabaseAdmin.from("plan_schedules").update({ claim_at: null }).eq("id", schedule.id);
      return { id: schedule.id, outcome: `insert_failed:${pErr?.message ?? "unknown"}` };
    }

    await insertChatMessage(
      userId,
      threadId,
      "assistant",
      "On it — planning and running your scheduled request now.",
      "plan",
      plan.id,
    );
    // Advance BEFORE the slow compose call so a timeout can't re-fire it.
    await advanceSchedule(schedule, plan.id);
    const allowed = ACTION_TOOL_GROUPS.filter((g) => caps[g]);
    await composePlan(plan.id, userId, allowed as string[]);
    return { id: schedule.id, outcome: "fired", plan_id: plan.id };
  }

  // Plain reply / web-search answer.
  if (result.route !== "resumed") {
    await insertChatMessage(userId, threadId, "assistant", result.text ?? "");
  }
  await advanceSchedule(schedule, null);
  return { id: schedule.id, outcome: "fired" };
}

/** Fire a classic plan-only schedule (no chat thread attached). */
async function firePlanSchedule(
  schedule: any,
): Promise<{ id: string; outcome: string; plan_id?: string }> {
  const userId = schedule.user_id;

  if (await hasNearbyScheduledPlan(userId)) {
    const bumped = new Date(Date.now() + SPACING_MINUTES * 60_000).toISOString();
    await supabaseAdmin
      .from("plan_schedules")
      .update({ next_run_at: bumped, claim_at: null })
      .eq("id", schedule.id);
    return { id: schedule.id, outcome: "deferred_spacing" };
  }

  const { data: plan, error: pErr } = await supabaseAdmin
    .from("plans")
    .insert({
      user_id: userId,
      status: "composing",
      user_request: schedule.user_request,
      attached_document_ids: schedule.attached_document_ids ?? [],
      schedule_id: schedule.id,
      scheduled_for: schedule.next_run_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (pErr || !plan) {
    await supabaseAdmin.from("plan_schedules").update({ claim_at: null }).eq("id", schedule.id);
    return { id: schedule.id, outcome: `insert_failed:${pErr?.message ?? "unknown"}` };
  }

  await advanceSchedule(schedule, plan.id);
  await composePlan(plan.id, userId, []);
  return { id: schedule.id, outcome: "fired", plan_id: plan.id };
}

export async function fireSchedule(
  schedule: any,
): Promise<{ id: string; outcome: string; plan_id?: string }> {
  return schedule.thread_id ? await fireChatSchedule(schedule) : await firePlanSchedule(schedule);
}
