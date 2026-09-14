// Server-only: the Orchestrator chat's standing autopilot.
//
// Between the user's visits this keeps reading the documents they told the
// Orchestrator to focus on, plus what the worker chats recently finished, and
// drafts new plans as PROPOSALS. Nothing runs until the user approves a
// proposal in the chat. Approved proposals are promoted into real plans one at
// a time per user, so a batch of approvals can never overload the system.
import { generateText } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createOpenAiProvider } from "./ai-gateway";
import { ALL_CAPS_ON, type ChatCapabilities } from "./chat-types";

/** How many drafted-but-unapproved proposals may wait at once. */
export const MAX_PENDING_PROPOSALS = 10;
/** How many new proposals one autopilot pass may draft. */
const MAX_DRAFTS_PER_PASS = 2;
/** Don't think again more often than this per user. */
const TICK_INTERVAL_MS = 25 * 60_000;

const ACTION_TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
  "web_search",
  "davinci_resolve",
  "virtual_computer",
];

export type OrchestratorState = {
  user_id: string;
  thread_id: string | null;
  focus_document_ids: string[];
  autopilot_enabled: boolean;
  last_tick_at: string | null;
};

/** Create the pinned Orchestrator chat and its state row if they don't exist. */
export async function ensureOrchestrator(
  db: any,
  userId: string,
): Promise<OrchestratorState> {
  const { data: existing } = await db
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("is_orchestrator", true)
    .maybeSingle();

  let threadId: string | null = existing?.id ?? null;
  if (!threadId) {
    const { data: created, error } = await db
      .from("chat_threads")
      .insert({
        user_id: userId,
        title: "🟢 Orchestrator",
        is_orchestrator: true,
        capabilities: { ...ALL_CAPS_ON },
        attached_document_ids: [],
        auto_approve_plans: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    threadId = created.id as string;
  }

  const { data: state } = await db
    .from("orchestrator_state")
    .select("user_id, thread_id, focus_document_ids, autopilot_enabled, last_tick_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!state) {
    const { data: inserted, error } = await db
      .from("orchestrator_state")
      .insert({ user_id: userId, thread_id: threadId })
      .select("user_id, thread_id, focus_document_ids, autopilot_enabled, last_tick_at")
      .single();
    if (error) throw new Error(error.message);
    return normalizeState(inserted);
  }

  if (state.thread_id !== threadId) {
    await db.from("orchestrator_state").update({ thread_id: threadId }).eq("user_id", userId);
  }
  return normalizeState({ ...state, thread_id: threadId });
}

function normalizeState(row: any): OrchestratorState {
  return {
    user_id: row.user_id,
    thread_id: row.thread_id ?? null,
    focus_document_ids: (row.focus_document_ids ?? []) as string[],
    autopilot_enabled: row.autopilot_enabled !== false,
    last_tick_at: row.last_tick_at ?? null,
  };
}

/** True when this user already has a plan being composed, approved or running. */
async function hasActivePlan(userId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("plans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["composing", "approved", "running", "awaiting_user", "awaiting_vc"]);
  return (count ?? 0) > 0;
}

/**
 * Turn the oldest approved proposal into a real plan — but only when nothing
 * else is running for this user, so the queue drains one plan at a time.
 */
export async function promoteApprovedProposals(
  userId: string,
): Promise<{ promoted: string | null }> {
  if (await hasActivePlan(userId)) return { promoted: null };

  const { data: next } = await supabaseAdmin
    .from("plan_proposals")
    .select("id, thread_id, user_request, proposed_capabilities, attached_document_ids")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return { promoted: null };

  const caps = {
    ...ALL_CAPS_ON,
    ...(next.proposed_capabilities && typeof next.proposed_capabilities === "object"
      ? (next.proposed_capabilities as Record<string, boolean>)
      : {}),
  } as ChatCapabilities;

  const { data: plan, error } = await supabaseAdmin
    .from("plans")
    .insert({
      user_id: userId,
      status: "composing",
      user_request: next.user_request,
      attached_document_ids: next.attached_document_ids ?? [],
      thread_id: next.thread_id,
      review_in_chat: true,
      proposed_capabilities: caps as any,
      // The user already approved this proposal — run it once it's composed.
      auto_approve_after_compose: true,
    } as any)
    .select("id")
    .single();
  if (error || !plan) {
    console.error("[orchestrator] couldn't start approved proposal", error?.message);
    return { promoted: null };
  }

  await supabaseAdmin
    .from("plan_proposals")
    .update({ status: "running", plan_id: (plan as any).id })
    .eq("id", next.id);

  if (next.thread_id) {
    await supabaseAdmin.from("chat_messages").insert({
      user_id: userId,
      thread_id: next.thread_id,
      role: "assistant",
      author: "assistant",
      content: "Starting the plan you approved.",
      kind: "plan",
      plan_id: (plan as any).id,
    } as any);
  }

  const allowed = ACTION_TOOL_GROUPS.filter((g) => caps[g]) as string[];
  await composePlan((plan as any).id, userId, allowed);
  return { promoted: (plan as any).id };
}

async function composePlan(planId: string, userId: string, allowedGroups: string[]) {
  const SUPABASE_URL = process.env["SUPABASE_URL"]!;
  const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const PLAN_TICK_SECRET = process.env["PLAN_TICK_SECRET"]!;
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
    });
  } catch (err) {
    console.error("[orchestrator] plan-compose invocation failed", err);
  }
}

function tryParseJson<T>(raw: string): T | null {
  const t = (raw ?? "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : t;
  try {
    return JSON.parse(body) as T;
  } catch {
    const m = body.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    return null;
  }
}

/** Draft up to a couple of fresh proposals from the focus documents. */
export async function draftProposals(
  state: OrchestratorState,
): Promise<{ drafted: number }> {
  const userId = state.user_id;
  if (!state.autopilot_enabled || !state.thread_id) return { drafted: 0 };
  if (!state.focus_document_ids.length) return { drafted: 0 };

  const { data: pending } = await supabaseAdmin
    .from("plan_proposals")
    .select("id, title, user_request")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(MAX_PENDING_PROPOSALS);
  const pendingRows = pending ?? [];
  if (pendingRows.length >= MAX_PENDING_PROPOSALS) return { drafted: 0 };

  // Focus documents, with their text.
  const { buildDocumentBlock } = await import("./assistant-context.server");
  const { text: focusText } = await buildDocumentBlock(
    supabaseAdmin,
    state.focus_document_ids.slice(0, 10),
    { ownerId: userId },
  );

  // What the workers recently finished, so it builds on real outcomes.
  const { data: recentPlans } = await supabaseAdmin
    .from("plans")
    .select("user_request, status, result_summary, created_at, thread_id")
    .eq("user_id", userId)
    .in("status", ["completed", "failed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(8);
  const outcomeLines = (recentPlans ?? [])
    .map(
      (p: any) =>
        `- [${p.status}] ${String(p.user_request ?? "").slice(0, 200)}${
          p.result_summary ? ` → ${String(p.result_summary).slice(0, 300)}` : ""
        }`,
    )
    .join("\n");

  const { data: workers } = await supabaseAdmin
    .from("chat_threads")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .eq("is_orchestrator", false)
    .order("updated_at", { ascending: false })
    .limit(30);
  const workerLines = (workers ?? [])
    .map((w: any) => `  ${w.id} — ${JSON.stringify(w.title ?? "")}`)
    .join("\n");

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return { drafted: 0 };
  const provider = createOpenAiProvider(apiKey);
  const model = provider("gpt-5.6-sol");

  const room = Math.min(MAX_DRAFTS_PER_PASS, MAX_PENDING_PROPOSALS - pendingRows.length);

  const system =
    "You are Orby's Orchestrator, the user's chief of staff inside their documents-and-media app. " +
    "Between the user's visits you review the documents they asked you to focus on and propose NEW work for them to approve. " +
    "You never carry work out here — you only propose it.\n\n" +
    `Return STRICT JSON only: {"proposals":[{"title":"short human title","request":"the full request, written as the user would type it","why":"one plain sentence on why now"}]}\n\n` +
    `RULES:\n` +
    `- Propose at most ${room} item(s). Propose ZERO (an empty array) whenever there is nothing genuinely worth doing — that is the normal answer.\n` +
    "- Each request must be concrete, self-contained and doable inside the app: editing or creating documents, generating images or videos, researching online, briefing or delegating to a worker chat, or scheduling work.\n" +
    "- Never repeat or paraphrase something already waiting for approval, and never redo work that already completed.\n" +
    "- Never propose buying anything, messaging anyone outside the app, or deleting documents.\n" +
    "- Plain text only, no markdown.";

  const promptParts = [
    `FOCUS DOCUMENTS (what the user asked you to keep an eye on):\n${focusText || "(empty)"}`,
    workerLines ? `WORKER CHATS (id — title):\n${workerLines}` : "WORKER CHATS: none yet.",
    outcomeLines ? `RECENTLY FINISHED WORK:\n${outcomeLines}` : "",
    pendingRows.length
      ? `ALREADY WAITING FOR APPROVAL (do not repeat these):\n${pendingRows
          .map((p: any) => `- ${p.title ?? ""}: ${String(p.user_request ?? "").slice(0, 200)}`)
          .join("\n")}`
      : "",
    "Return JSON.",
  ].filter(Boolean);

  let raw = "";
  try {
    const { text } = await generateText({
      model,
      system,
      messages: [{ role: "user", content: promptParts.join("\n\n") }],
    });
    raw = text ?? "";
  } catch (e) {
    console.warn("[orchestrator] drafting failed", e);
    return { drafted: 0 };
  }

  const parsed = tryParseJson<{ proposals?: { title?: string; request?: string; why?: string }[] }>(raw);
  const list = Array.isArray(parsed?.proposals) ? parsed!.proposals!.slice(0, room) : [];
  let drafted = 0;
  for (const p of list) {
    const request = String(p?.request ?? "").trim();
    if (!request) continue;
    const { error } = await supabaseAdmin.from("plan_proposals").insert({
      user_id: userId,
      thread_id: state.thread_id,
      status: "pending",
      title: String(p?.title ?? "").trim().slice(0, 120) || "New idea",
      plan_summary: String(p?.why ?? "").trim().slice(0, 500) || null,
      user_request: request.slice(0, 4000),
      proposed_capabilities: { ...ALL_CAPS_ON } as any,
      attached_document_ids: state.focus_document_ids,
      source: "autopilot",
    } as any);
    if (!error) drafted += 1;
  }

  // Drop the oldest untouched proposals when we're over the cap.
  const { data: allPending } = await supabaseAdmin
    .from("plan_proposals")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  const overflow = (allPending ?? []).slice(MAX_PENDING_PROPOSALS).map((r: any) => r.id);
  if (overflow.length) {
    await supabaseAdmin.from("plan_proposals").update({ status: "expired" }).in("id", overflow);
  }

  await supabaseAdmin
    .from("orchestrator_state")
    .update({ last_tick_at: new Date().toISOString() })
    .eq("user_id", userId);

  return { drafted };
}

/**
 * One autopilot pass across every user who has an Orchestrator chat: drain the
 * approved queue first, then think about what to propose next.
 */
export async function runOrchestratorTick(
  limit = 20,
): Promise<{ user_id: string; promoted: string | null; drafted: number }[]> {
  const { data: rows } = await supabaseAdmin
    .from("orchestrator_state")
    .select("user_id, thread_id, focus_document_ids, autopilot_enabled, last_tick_at")
    .order("last_tick_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const out: { user_id: string; promoted: string | null; drafted: number }[] = [];
  for (const raw of rows ?? []) {
    const state = normalizeState(raw);
    let promoted: string | null = null;
    let drafted = 0;
    try {
      promoted = (await promoteApprovedProposals(state.user_id)).promoted;
    } catch (e) {
      console.warn("[orchestrator] promote failed", e);
    }
    const due =
      !state.last_tick_at || Date.now() - Date.parse(state.last_tick_at) > TICK_INTERVAL_MS;
    if (due && state.autopilot_enabled) {
      try {
        drafted = (await draftProposals(state)).drafted;
      } catch (e) {
        console.warn("[orchestrator] draft failed", e);
      }
    }
    out.push({ user_id: state.user_id, promoted, drafted });
  }
  return out;
}
