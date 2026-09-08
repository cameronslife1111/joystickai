import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  code: z.string().min(4).max(32),
  server_info: z.record(z.unknown()).optional(),
});

/**
 * The local Orby bridge exchanges a one-time pairing code for a long-lived
 * bridge token. Verified by the code itself — this prefix is unauthenticated.
 */
export const Route = createFileRoute("/api/public/mcp-bridge/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { hashToken, makeBridgeToken } = await import("@/lib/mcp-bridge.server");

        const code = parsed.data.code.trim().toUpperCase();
        const { data: conn } = await supabaseAdmin
          .from("mcp_connections")
          .select("id, provider, pairing_expires_at")
          .eq("pairing_code", code)
          .maybeSingle();
        if (!conn) return Response.json({ error: "That pairing code isn't valid." }, { status: 404 });
        if (conn.pairing_expires_at && new Date(conn.pairing_expires_at).getTime() < Date.now()) {
          return Response.json(
            {
              error:
                'That code has run out. In Orby chat, with DaVinci Resolve Mode on, tap "Get a fresh command".',
            },
            { status: 410 },
          );
        }

        const token = makeBridgeToken();
        const { error } = await supabaseAdmin
          .from("mcp_connections")
          .update({
            status: "connected",
            token_hash: await hashToken(token),
            pairing_code: null,
            pairing_expires_at: null,
            server_info: (parsed.data.server_info ?? {}) as any,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", conn.id);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({ token, provider: conn.provider });
      },
    },
  },
});
