// Server-only: runs one queued chat turn to completion and persists the result.
//
// Why this exists: the reply used to be produced by the phone (the client waited
// on the server call, then wrote the assistant message itself). Any interruption
// of that round trip — switching apps on iOS suspends the tab and kills the
// fetch — surfaced as "Load failed" and lost the reply even though the work had
// started. Now the client only queues a chat_turns row and nudges the server;
// the turn is finished here, and a watchdog tick finishes anything left behind.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeCapabilities, type ChatCapabilities } from "@/lib/chat-types";
import { runChatTurn } from "@/lib/chat-core.server";

/** Capability keys that map to plan tool groups (mirrors the chat client). */
const ACTION_TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
  "web_search",
  "davinci_resolve",
];

/** A claimed turn is considered abandoned after this long. */
export const TURN_STALE_MS = 120_000;
export const TURN_MAX_ATTEMPTS = 3;
/** How long a pending turn is left to the client's own nudge before the tick adopts it. */
export const PENDING_GRACE_MS = 20_000;

export type ChatTurnPayload = {
  userText: string;
  messages: { role: "user" | "assistant"; content: string }[];
  contextDocumentIds: string[];
  imageUrls: string[];
  capabilities: ChatCapabilities;
  autoCapabilities?: boolean;
  autoApprove?: boolean;
};

type TurnRow = {
  id: string;
  user_id: string;
  thread_id: string;
  status: string;
  payload: any;
  attempts: number;
  claim_at: string | null;
};

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
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error("[chat turn] plan-compose invocation failed", err);
  }
}

async function insertAssistant(
  userId: string,
  threadId: string,
  content: string,
  kind: "text" | "plan" = "text",
  planId: string | null = null,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      user_id: userId,
      thread_id: threadId,
      role: "assistant",
      content,
      kind,
      plan_id: planId,
    } as any)
    .select("id")
    .single();
  if (error) {
    console.error("[chat turn] assistant insert failed", error.message);
    return null;
  }
  const stamp = new Date().toISOString();
  await supabaseAdmin
    .from("chat_threads")
    .update({ updated_at: stamp, last_assistant_at: stamp } as any)
    .eq("id", threadId);
  return (data as any)?.id ?? null;
}

/**
 * Claim the turn so two runners (the client's nudge and the watchdog tick)
 * never run the same turn twice. Returns false when someone else owns it.
 */
async function claimTurn(turn: TurnRow): Promise<boolean> {
  const patch = {
    status: "running",
    claim_at: new Date().toISOString(),
    attempts: (turn.attempts ?? 0) + 1,
    updated_at: new Date().toISOString(),
  } as any;

  if (turn.status === "pending") {
    const { data } = await supabaseAdmin
      .from("chat_turns")
      .update(patch)
      .eq("id", turn.id)
      .eq("status", "pending")
      .select("id");
    return !!(data && data.length > 0);
  }

  if (turn.status === "running") {
    const claimedAt = turn.claim_at ? Date.parse(turn.claim_at) : 0;
    if (Date.now() - claimedAt < TURN_STALE_MS) return false;
    const query = supabaseAdmin
      .from("chat_turns")
      .update(patch)
      .eq("id", turn.id)
      .eq("status", "running");
    const { data } = await (turn.claim_at
      ? query.eq("claim_at", turn.claim_at)
      : query.is("claim_at", null)
    ).select("id");
    return !!(data && data.length > 0);
  }

  return false;
}

/** True when the user pressed Stop on this turn while it was running. */
async function wasCanceled(turnId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("chat_turns")
    .select("status")
    .eq("id", turnId)
    .maybeSingle();
  return (data as any)?.status === "canceled";
}

/**
 * Run one queued turn. Safe to call concurrently and repeatedly: claiming is
 * guarded, and a finished turn is a no-op.
 */

export async function runQueuedChatTurn(turnId: string): Promise<{ outcome: string }> {
  const { data: row, error } = await supabaseAdmin
    .from("chat_turns")
    .select("id, user_id, thread_id, status, payload, attempts, claim_at")
    .eq("id", turnId)
    .maybeSingle();
  if (error) return { outcome: `lookup_failed:${error.message}` };
  const turn = row as TurnRow | null;
  if (!turn) return { outcome: "missing" };
  if (turn.status === "done" || turn.status === "failed" || turn.status === "canceled")
    return { outcome: turn.status };


  if (!(await claimTurn(turn))) return { outcome: "claimed_elsewhere" };

  const attempts = (turn.attempts ?? 0) + 1;
  const payload = (turn.payload ?? {}) as ChatTurnPayload;
  const userId = turn.user_id;
  const threadId = turn.thread_id;
  const capsUsed = normalizeCapabilities(payload.capabilities);

  try {
    // This runner uses the service-role client, so nothing in the queued row is
    // taken on trust: the chat must belong to the person who queued the turn,
    // and only their own documents can be used as context.
    const { data: ownThread } = await supabaseAdmin
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!ownThread) {
      await supabaseAdmin
        .from("chat_turns")
        .update({
          status: "failed",
          claim_at: null,
          error: "thread_not_owned",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", turn.id);
      return { outcome: "thread_not_owned" };
    }

    const { filterOwnedDocumentIds } = await import("@/lib/assistant-context.server");
    const ownedDocIds = await filterOwnedDocumentIds(
      supabaseAdmin,
      userId,
      (payload.contextDocumentIds ?? []).slice(0, 20),
    );

    const result = await runChatTurn(supabaseAdmin, {
      messages: payload.messages ?? [],
      contextDocumentIds: ownedDocIds,
      imageUrls: capsUsed.image_analysis ? (payload.imageUrls ?? []).slice(0, 6) : [],
      threadId,
      capabilities: capsUsed,
      autoCapabilities: payload.autoCapabilities === true,
      ownerId: userId,
    } as any);

    // The user pressed Stop while this was thinking → throw the answer away
    // and post nothing into the chat.
    if (await wasCanceled(turn.id)) return { outcome: "canceled" };

    let assistantMessageId: string | null = null;



    if (result.route === "plan") {
      const decided = (result.capabilities ?? capsUsed) as ChatCapabilities;
      const mergedCaps = { ...decided } as ChatCapabilities;
      for (const g of ACTION_TOOL_GROUPS) if (capsUsed[g]) mergedCaps[g] = true;
      // "Planning" alone still needs somewhere to put the work.
      if (!ACTION_TOOL_GROUPS.some((g) => mergedCaps[g])) mergedCaps.document_editing = true;
      const allowedGroups = ACTION_TOOL_GROUPS.filter((g) => mergedCaps[g]) as string[];

      const { data: planRow, error: planErr } = await supabaseAdmin
        .from("plans")
        .insert({
          user_id: userId,
          status: "composing",
          user_request: payload.userText ?? "",
          attached_document_ids: ownedDocIds,
          thread_id: threadId,
          review_in_chat: true,
          proposed_capabilities: mergedCaps as any,
          auto_approve_after_compose: payload.autoApprove === true,
        } as any)
        .select("id")
        .single();
      if (planErr || !planRow) throw new Error(planErr?.message || "Couldn't start the plan");

      assistantMessageId = await insertAssistant(
        userId,
        threadId,
        payload.autoApprove
          ? "On it — writing a plan and starting it."
          : "On it — writing a plan for you to review.",
        "plan",
        (planRow as any).id,
      );
      await composePlan((planRow as any).id, userId, allowedGroups);
    } else if (result.route !== "resumed") {
      assistantMessageId = await insertAssistant(userId, threadId, result.text ?? "");
    } else {
      // The message answered a paused plan; the plan posts its own follow-ups.
      await supabaseAdmin
        .from("chat_threads")
        .update({ updated_at: new Date().toISOString() } as any)
        .eq("id", threadId);
    }

    await supabaseAdmin
      .from("chat_turns")
      .update({
        status: "done",
        claim_at: null,
        error: null,
        updated_at: new Date().toISOString(),
        payload: { ...payload, assistantMessageId, route: result.route } as any,
      } as any)
      .eq("id", turn.id);

    return { outcome: "done" };
  } catch (err) {
    const message = String((err as any)?.message ?? err);
    console.error("[chat turn] failed", turn.id, message);

    // Stopped by the user — no error message, no retry.
    if (await wasCanceled(turn.id)) return { outcome: "canceled" };


    if (attempts >= TURN_MAX_ATTEMPTS) {
      await insertAssistant(
        userId,
        threadId,
        "That message ran into a problem and couldn't be answered: " + message,
      );
      await supabaseAdmin
        .from("chat_turns")
        .update({
          status: "failed",
          claim_at: null,
          error: message.slice(0, 2_000),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", turn.id);
      return { outcome: "failed" };
    }

    // Put it back in the queue; the watchdog tick retries it shortly.
    await supabaseAdmin
      .from("chat_turns")
      .update({
        status: "pending",
        claim_at: null,
        error: message.slice(0, 2_000),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", turn.id);
    return { outcome: "requeued" };
  }
}

/** Watchdog: finish turns nobody completed (client torn down mid-flight). */
export async function runStaleChatTurns(limit = 5): Promise<{ id: string; outcome: string }[]> {
  const staleCutoff = new Date(Date.now() - TURN_STALE_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("chat_turns")
    .select("id, status, claim_at, created_at, updated_at")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: true })
    .limit(40);

  // A freshly queued turn belongs to the client's own nudge for a few seconds;
  // only adopt it once that nudge has clearly not landed.
  const pendingCutoff = new Date(Date.now() - PENDING_GRACE_MS).toISOString();
  const rows = (data ?? []) as {
    id: string;
    status: string;
    claim_at: string | null;
    updated_at: string | null;
  }[];
  const due = rows
    .filter((r) =>
      r.status === "pending"
        ? (r.updated_at ?? "") < pendingCutoff
        : !!r.claim_at && r.claim_at < staleCutoff,
    )
    .slice(0, limit);

  const results: { id: string; outcome: string }[] = [];
  for (const r of due) {
    const { outcome } = await runQueuedChatTurn(r.id);
    results.push({ id: r.id, outcome });
  }
  return results;
}
