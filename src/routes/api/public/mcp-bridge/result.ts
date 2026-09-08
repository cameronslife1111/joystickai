import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  token: z.string().min(16).max(200),
  command_id: z.string().uuid(),
  result: z.unknown().optional(),
  error: z.string().max(4000).optional(),
});

/** The bridge posts back the MCP tool result (or the error it hit). */
export const Route = createFileRoute("/api/public/mcp-bridge/result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { hashToken } = await import("@/lib/mcp-bridge.server");

        const { data: conn } = await supabaseAdmin
          .from("mcp_connections")
          .select("id")
          .eq("token_hash", await hashToken(parsed.data.token))
          .maybeSingle();
        if (!conn) return new Response("Unauthorized", { status: 401 });

        const failed = !!parsed.data.error;
        const { error } = await supabaseAdmin
          .from("mcp_commands")
          .update({
            status: failed ? "error" : "done",
            result: failed ? null : ((parsed.data.result ?? null) as any),
            error: parsed.data.error ?? null,
            finished_at: new Date().toISOString(),
          })
          .eq("id", parsed.data.command_id)
          .eq("connection_id", conn.id);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        await supabaseAdmin
          .from("mcp_connections")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", conn.id);

        return Response.json({ ok: true });
      },
    },
  },
});
