import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MCP_PROVIDERS, type McpConnectionStatus, type McpProviderId } from "./mcp-providers";

const providerSchema = z.object({
  provider: z.enum(["davinci_resolve"]),
});

/** How long a pairing code stays usable. */
const PAIRING_TTL_MS = 12 * 60 * 60_000;

function shape(row: any, provider: McpProviderId): McpConnectionStatus {
  const raw = row?.server_info;
  let serverInfo: Record<string, string> | null = null;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    serverInfo = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null) continue;
      serverInfo[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  // An expired code is worse than no code — the UI must never offer it.
  const expiresAt: string | null = row?.pairing_expires_at ?? null;
  const expired = !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
  const code: string | null = expired ? null : (row?.pairing_code ?? null);
  return {
    provider,
    status: (row?.status ?? "none") as McpConnectionStatus["status"],
    pairingCode: code,
    pairingExpiresAt: code ? expiresAt : null,
    lastSeenAt: row?.last_seen_at ?? null,
    serverInfo,
  };
}


/** Current connection state for one provider (used by the chat status pill). */
export const getMcpConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => providerSchema.parse(input))
  .handler(async ({ data, context }): Promise<McpConnectionStatus> => {
    const { data: row } = await context.supabase
      .from("mcp_connections")
      .select("status, pairing_code, pairing_expires_at, last_seen_at, server_info")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .maybeSingle();

    if (!row) return shape(null, data.provider);

    // Bridge stopped checking in → show it as offline rather than connected.
    const { isLive } = await import("./mcp-bridge.server");
    if (row.status === "connected" && !isLive(row.last_seen_at)) {
      return { ...shape(row, data.provider), status: "offline" };
    }
    return shape(row, data.provider);
  });

/**
 * Mint (or refresh) a one-time pairing code. The user runs the bridge on the
 * computer where the creative app lives and types this code once.
 */
export const startMcpPairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => providerSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ code: string; command: string }> => {
    const { makePairingCode } = await import("./mcp-bridge.server");
    const code = makePairingCode();
    const expires = new Date(Date.now() + 30 * 60_000).toISOString();

    const { error } = await context.supabase
      .from("mcp_connections")
      .upsert(
        {
          user_id: context.userId,
          provider: data.provider,
          status: "pending",
          pairing_code: code,
          pairing_expires_at: expires,
          token_hash: null,
        },
        { onConflict: "user_id,provider" },
      );
    if (error) throw new Error(error.message);

    return { code, command: MCP_PROVIDERS[data.provider].installCommand(code) };
  });

/** Forget the connection entirely (the user has to pair again). */
export const disconnectMcpProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => providerSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await context.supabase
      .from("mcp_connections")
      .delete()
      .eq("user_id", context.userId)
      .eq("provider", data.provider);
    return { ok: true };
  });

const callSchema = z.object({
  provider: z.enum(["davinci_resolve"]),
  tool: z.string().min(1).max(120),
  arguments: z.record(z.unknown()).default({}),
  timeoutMs: z.number().int().min(1000).max(120_000).default(60_000),
});

/**
 * Queue one MCP tool call for the local bridge and wait for the result.
 * Used by chat-side actions; plans run the same queue from plan-step.
 */
export const callMcpTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => callSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; result?: string; error?: string }> => {
      const { data: conn } = await context.supabase
        .from("mcp_connections")
        .select("id, status, last_seen_at")
        .eq("user_id", context.userId)
        .eq("provider", data.provider)
        .maybeSingle();
      if (!conn) return { ok: false, error: `${MCP_PROVIDERS[data.provider].name} isn't connected yet.` };

      const { isLive } = await import("./mcp-bridge.server");
      if (conn.status !== "connected" || !isLive(conn.last_seen_at)) {
        return {
          ok: false,
          error: `${MCP_PROVIDERS[data.provider].name} isn't reachable right now — start the Orby bridge on that computer.`,
        };
      }

      const { data: cmd, error: insErr } = await context.supabase
        .from("mcp_commands")
        .insert({
          user_id: context.userId,
          connection_id: conn.id,
          tool_name: data.tool,
          arguments: data.arguments as any,
        })
        .select("id")
        .single();
      if (insErr || !cmd) return { ok: false, error: insErr?.message ?? "Couldn't queue that command." };

      const deadline = Date.now() + data.timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 900));
        const { data: row } = await context.supabase
          .from("mcp_commands")
          .select("status, result, error")
          .eq("id", cmd.id)
          .maybeSingle();
        if (row?.status === "done")
          return { ok: true, result: row.result == null ? "" : JSON.stringify(row.result) };

        if (row?.status === "error") return { ok: false, error: row.error ?? "The command failed." };
      }
      return { ok: false, error: "The app didn't answer in time." };
    },
  );
