// Client-callable server functions for the pinned Orchestrator chat.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Create (or find) the Orchestrator chat and return its settings. */
export const getOrchestrator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureOrchestrator } = await import("@/lib/orchestrator.server");
    const state = await ensureOrchestrator(context.supabase, context.userId);
    return {
      threadId: state.thread_id,
      focusDocumentIds: state.focus_document_ids,
      autopilotEnabled: state.autopilot_enabled,
    };
  });

const focusSchema = z.object({ documentIds: z.array(z.string().uuid()).max(20) });

/** Choose which documents the Orchestrator keeps an eye on between visits. */
export const setOrchestratorFocus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => focusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { ensureOrchestrator } = await import("@/lib/orchestrator.server");
    await ensureOrchestrator(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("orchestrator_state")
      .update({ focus_document_ids: data.documentIds } as any)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, focusDocumentIds: data.documentIds };
  });

/** Pause or resume the standing autopilot. */
export const setOrchestratorAutopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { ensureOrchestrator } = await import("@/lib/orchestrator.server");
    await ensureOrchestrator(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("orchestrator_state")
      .update({ autopilot_enabled: data.enabled } as any)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, autopilotEnabled: data.enabled };
  });

const proposalSchema = z.object({ proposalId: z.string().uuid() });

/**
 * Approve a drafted proposal. It joins the queue and the next tick starts it —
 * one plan at a time, in approval order.
 */
export const approveProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => proposalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("plan_proposals")
      .update({ status: "approved", approved_at: new Date().toISOString() } as any)
      .eq("id", data.proposalId)
      .eq("user_id", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    // Try to start it right away when nothing else is running.
    const { promoteApprovedProposals } = await import("@/lib/orchestrator.server");
    const { promoted } = await promoteApprovedProposals(context.userId);
    return { ok: true, started: !!promoted };
  });

/** Throw a drafted proposal away. */
export const dismissProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => proposalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("plan_proposals")
      .update({ status: "dismissed" } as any)
      .eq("id", data.proposalId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
