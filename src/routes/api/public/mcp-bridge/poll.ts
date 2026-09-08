import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  token: z.string().min(16).max(200),
  server_info: z.record(z.unknown()).optional(),
});

/**
 * The bridge asks for its next queued command and reports that it's alive.
 * Returns `{ command: null }` when there is nothing to do.
 */
export const Route = createFileRoute("/api/public/mcp-bridge/poll")({
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

        await supabaseAdmin
          .from("mcp_connections")
          .update({
            status: "connected",
            last_seen_at: new Date().toISOString(),
            ...(parsed.data.server_info ? { server_info: parsed.data.server_info as any } : {}),
          })
          .eq("id", conn.id);

        const { data: next } = await supabaseAdmin
          .from("mcp_commands")
          .select("id, tool_name, arguments")
          .eq("connection_id", conn.id)
          .eq("status", "queued")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!next) return Response.json({ command: null });

        await supabaseAdmin
          .from("mcp_commands")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", next.id);

        return Response.json({
          command: { id: next.id, tool: next.tool_name, arguments: next.arguments ?? {} },
        });
      },
    },
  },
});
