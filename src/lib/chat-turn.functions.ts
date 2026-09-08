import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const turnSchema = z.object({ turnId: z.string().uuid() });

/**
 * Run a queued chat turn on the server. The client fires this and forgets: if
 * the phone is suspended (app switch) and this call never returns, the turn is
 * still finished server-side, and the watchdog tick picks up anything dropped
 * before it started.
 */
export const processChatTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => turnSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ outcome: string }> => {
    // Only the owner of the turn may run it.
    const { data: turn, error } = await context.supabase
      .from("chat_turns")
      .select("id")
      .eq("id", data.turnId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!turn) throw new Error("Chat turn not found");

    const { runQueuedChatTurn } = await import("./chat-turn.server");
    return await runQueuedChatTurn(data.turnId);
  });
