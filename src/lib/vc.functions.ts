// Client-callable actions for the Virtual Computer (a temporary cloud browser).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Nudge one run forward now (the card calls this while it's open). */
export const pokeVirtualComputer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("vc_runs")
      .select("id, user_id")
      .eq("id", data.runId)
      .maybeSingle();
    if (!row || row.user_id !== context.userId) return { ok: false, error: "not found" };
    const { pollVcRun } = await import("@/lib/vc.server");
    return await pollVcRun(data.runId);
  });

/** Stop the machine right now. */
export const stopVirtualComputer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("vc_runs")
      .select("id, user_id, plan_id")
      .eq("id", data.runId)
      .maybeSingle();
    if (!row || row.user_id !== context.userId) return { ok: false, error: "not found" };
    const { stopVcRun } = await import("@/lib/vc.server");
    const res = await stopVcRun(data.runId);
    // A plan waiting on this run should stop waiting too.
    if (row.plan_id) {
      await (supabaseAdmin as any)
        .from("plans")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", row.plan_id)
        .eq("user_id", context.userId)
        .in("status", ["awaiting_vc", "running", "approved"]);
    }
    return res;
  });

/** Hand over a password or a one-time code; typed straight into the page. */
export const sendVirtualComputerSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string; value: string; remember?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const value = String(data.value ?? "").trim();
    if (!value) return { ok: false, error: "Nothing was entered." };
    if (value.length > 500) return { ok: false, error: "That's too long to be a password or code." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("vc_runs")
      .select("id, user_id")
      .eq("id", data.runId)
      .maybeSingle();
    if (!row || row.user_id !== context.userId) return { ok: false, error: "not found" };
    const { submitVcSecret } = await import("@/lib/vc.server");
    return await submitVcSecret(data.runId, value, data.remember !== false);
  });

/** Forget every saved login and the saved machine profile. */
export const forgetVirtualComputerLogins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { forgetVcLogins } = await import("@/lib/vc.server");
    return await forgetVcLogins(context.userId);
  });
