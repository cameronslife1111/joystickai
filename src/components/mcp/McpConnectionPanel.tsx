import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Copy, Loader2, Plug, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  disconnectMcpProvider,
  getMcpConnection,
  startMcpPairing,
} from "@/lib/mcp-connections.functions";
import { MCP_PROVIDERS, type McpProviderId } from "@/lib/mcp-providers";

/**
 * Provider-agnostic connection UI for an external creative app driven through
 * the local Orby bridge. Adding Photoshop/Blender/VS Code needs no change here.
 */
export function useMcpConnection(provider: McpProviderId, enabled: boolean) {
  const fetchStatus = useServerFn(getMcpConnection);
  return useQuery({
    queryKey: ["mcp_connection", provider],
    enabled,
    refetchInterval: enabled ? 5000 : false,
    queryFn: () => fetchStatus({ data: { provider } }),
  });
}

export function McpStatusPill({ provider }: { provider: McpProviderId }) {
  const meta = MCP_PROVIDERS[provider];
  const { data } = useMcpConnection(provider, true);
  const status = data?.status ?? "none";
  const info = (data?.serverInfo ?? {}) as Record<string, any>;
  const detail =
    status === "connected"
      ? [info.version ? `Resolve ${info.version}` : null, info.project ? `project: ${info.project}` : null]
          .filter(Boolean)
          .join(" · ")
      : status === "offline"
        ? "not reachable right now"
        : status === "pending"
          ? "waiting for your computer"
          : "not connected";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1 text-[11px]",
        status === "connected"
          ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
          : "border-foreground/15 bg-muted/40 text-muted-foreground",
      )}
    >
      <span>{meta.emoji}</span>
      <span className="font-medium">{meta.name}</span>
      <span className="truncate">{detail}</span>
    </div>
  );
}

export function McpConnectionPanel({ provider }: { provider: McpProviderId }) {
  const meta = MCP_PROVIDERS[provider];
  const qc = useQueryClient();
  const { data, isLoading } = useMcpConnection(provider, true);
  const pair = useServerFn(startMcpPairing);
  const unpair = useServerFn(disconnectMcpProvider);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<string | null>(null);

  const status = data?.status ?? "none";

  useEffect(() => {
    if (status === "connected") setCommand(null);
  }, [status]);

  const begin = useCallback(async () => {
    setBusy(true);
    try {
      const res = await pair({ data: { provider } });
      setCommand(res.command);
      void qc.invalidateQueries({ queryKey: ["mcp_connection", provider] });
    } catch (e) {
      toast.error((e as Error).message || "Couldn't start the setup");
    } finally {
      setBusy(false);
    }
  }, [pair, provider, qc]);

  const drop = useCallback(async () => {
    setBusy(true);
    try {
      await unpair({ data: { provider } });
      setCommand(null);
      void qc.invalidateQueries({ queryKey: ["mcp_connection", provider] });
      toast.success(`${meta.name} disconnected`, { emoji: meta.emoji });
    } finally {
      setBusy(false);
    }
  }, [unpair, provider, qc, meta]);

  const shown = command ?? (data?.pairingCode ? meta.installCommand(data.pairingCode) : null);

  return (
    <div className="rounded-lg border border-foreground/10 bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">
          {meta.emoji} {meta.name}
        </span>
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : status === "connected" ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {status === "offline" ? "Offline" : status === "pending" ? "Waiting…" : "Not connected"}
          </span>
        )}
      </div>

      {status === "connected" ? (
        <>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Just talk normally — Orby will do the work in {meta.name} for you.
          </p>
          <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => void drop()}>
            <Unplug className="mr-2 h-4 w-4" /> Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-snug text-muted-foreground">{meta.requirement}</p>
          {shown ? (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] leading-snug text-muted-foreground">
                On that computer, open a terminal and run this once:
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 text-[11px]">
                  {shown}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shown);
                    toast.success("Copied", { emoji: "📋" });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                This page turns green by itself as soon as it connects.
              </p>
            </div>
          ) : (
            <Button size="sm" className="mt-2" disabled={busy} onClick={() => void begin()}>
              <Plug className="mr-2 h-4 w-4" /> Connect {meta.name}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
