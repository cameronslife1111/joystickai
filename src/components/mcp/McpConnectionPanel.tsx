import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronDown, Copy, Loader2, Plug, RefreshCw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  disconnectMcpProvider,
  getMcpConnection,
  startMcpPairing,
} from "@/lib/mcp-connections.functions";
import { MCP_PROVIDERS, groupedTools, type McpProviderId } from "@/lib/mcp-providers";


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
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const mintedRef = useRef(false);

  const status = data?.status ?? "none";

  useEffect(() => {
    if (status === "connected") {
      setCommand(null);
      setExpiresAt(null);
    }
  }, [status]);

  const begin = useCallback(async () => {
    setBusy(true);
    try {
      const res = await pair({ data: { provider } });
      setCommand(res.command);
      setExpiresAt(res.expiresAt);
      void qc.invalidateQueries({ queryKey: ["mcp_connection", provider] });
      return true;
    } catch (e) {
      toast.error((e as Error).message || "Couldn't start the setup");
      return false;
    } finally {
      setBusy(false);
    }
  }, [pair, provider, qc]);

  // Never show a dead code: mint one automatically when there isn't a live one.
  useEffect(() => {
    if (isLoading || status === "connected" || mintedRef.current) return;
    if (command || data?.pairingCode) return;
    mintedRef.current = true;
    void begin();
  }, [isLoading, status, command, data?.pairingCode, begin]);

  const drop = useCallback(async () => {
    setBusy(true);
    try {
      await unpair({ data: { provider } });
      setCommand(null);
      setExpiresAt(null);
      mintedRef.current = false;
      void qc.invalidateQueries({ queryKey: ["mcp_connection", provider] });
      toast.success(`${meta.name} disconnected`, { emoji: meta.emoji });
    } finally {
      setBusy(false);
    }
  }, [unpair, provider, qc, meta]);

  // Only ever render a code that is still good.
  const shown = command ?? (data?.pairingCode ? meta.installCommand(data.pairingCode) : null);
  const expiry = expiresAt ?? data?.pairingExpiresAt ?? null;
  const timeLeft = (() => {
    if (!expiry) return null;
    const ms = new Date(expiry).getTime() - Date.now();
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
  })();

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
            Just talk normally — Orby will do the work in {meta.name} for you. Keep the terminal
            window open.
          </p>
          <McpToolCatalog provider={provider} />
          <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => void drop()}>
            <Unplug className="mr-2 h-4 w-4" /> Disconnect
          </Button>
        </>
      ) : (

        <>
          <p className="text-[11px] leading-snug text-muted-foreground">{meta.requirement}</p>

          {shown ? (
            <div className="mt-3 space-y-3">
              <ol className="space-y-2">
                {meta.steps.map((s, i) => (
                  <li key={s.title} className="flex gap-2">
                    <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-semibold">
                      {i + 1}
                    </span>
                    <span className="min-w-0 text-[11px] leading-snug">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-muted-foreground"> — {s.body}</span>
                      {i === 0 ? (
                        <>
                          {" "}
                          <a
                            className="underline"
                            href="https://nodejs.org/en/download"
                            target="_blank"
                            rel="noreferrer"
                          >
                            nodejs.org
                          </a>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="space-y-1.5">
                <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-[10.5px] leading-snug">
                  {shown}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shown);
                    toast.success("Copied", { emoji: "📋" });
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy the command
                </Button>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] text-muted-foreground">
                    {timeLeft ? `Code good for another ${timeLeft}` : "Code ready"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10.5px]"
                    disabled={busy}
                    onClick={() => void begin()}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Get a fresh command
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium">Check these in {meta.name}</p>
                <ul className="space-y-1">
                  {meta.checklist.map((c) => (
                    <li key={c} className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
                      <span>•</span>
                      <span className="min-w-0">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium">If something goes wrong</p>
                <ul className="space-y-1">
                  {meta.troubleshooting.map((t) => (
                    <li key={t.problem} className="text-[11px] leading-snug">
                      <span className="font-medium">{t.problem}</span>
                      <span className="text-muted-foreground"> — {t.fix}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[11px] leading-snug text-muted-foreground">
                This card turns green by itself as soon as it connects.
              </p>

              <McpToolCatalog provider={provider} />
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

/**
 * The numbered "What can I ask for?" list, straight from the provider registry
 * so what the user reads is exactly what Orby can run.
 */
export function McpToolCatalog({ provider }: { provider: McpProviderId }) {
  const meta = MCP_PROVIDERS[provider];
  const [open, setOpen] = useState(false);
  const groups = groupedTools(meta);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-foreground/10 bg-background/60 px-2.5 py-2 text-left text-[11px] font-medium"
      >
        <span>What can I ask for? ({meta.tools.length} things)</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="mt-2 max-h-72 space-y-3 overflow-y-auto rounded-md border border-foreground/10 bg-background/60 p-2.5">
          {groups.map(({ group, tools }) => (
            <div key={group}>
              <p className="mb-1 text-[11px] font-semibold">{group}</p>
              <ol className="space-y-1">
                {tools.map(({ n, tool }) => (
                  <li key={tool.name} className="text-[11px] leading-snug">
                    <span className="text-muted-foreground">{n}. </span>
                    <span>{tool.description}</span>
                    <span className="block text-muted-foreground">“{tool.example}”</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A copy/paste line that only *reports* what the local app offers — Resolve
 * version, edition, and whether the app's own AI connection is listening.
 * Nothing is changed on the user's machine, so it's safe to run any time.
 */
export function McpCheckBlock({ provider }: { provider: McpProviderId }) {
  const meta = MCP_PROVIDERS[provider];
  const [open, setOpen] = useState(false);
  const cmd = meta.checkCommand();

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-foreground/10 bg-background/60 px-2.5 py-2 text-left text-[11px] font-medium"
      >
        <span>Check what your {meta.name} offers</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="mt-2 space-y-1.5 rounded-md border border-foreground/10 bg-background/60 p-2.5">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Run this in a terminal with {meta.name} open. It only looks — it changes nothing. Paste
            what it prints back into this chat.
          </p>
          <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-[10.5px] leading-snug">
            {cmd}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(cmd);
              toast.success("Copied", { emoji: "📋" });
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy the check command
          </Button>
        </div>
      ) : null}
    </div>
  );
}

