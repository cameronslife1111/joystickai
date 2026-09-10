// Live card for a Virtual Computer task: what it's doing, a window to watch it
// in, a Stop button, and a locked box for a password or texted code.
//
// The machine is a throwaway cloud browser. It is never the user's own computer.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Monitor, ExternalLink, Square, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  pokeVirtualComputer,
  sendVirtualComputerSecret,
  stopVirtualComputer,
} from "@/lib/vc.functions";

type Run = {
  id: string;
  status: string;
  phase_text: string | null;
  live_view_url: string | null;
  result: string | null;
  error: string | null;
  secret_request: { ask?: string; domain?: string; kind?: string } | null;
  thread_id: string | null;
  created_at: string;
};

const ACTIVE = ["starting", "running", "awaiting_secret"];

export function VirtualComputerCard({ threadId }: { threadId: string | null }) {
  const poke = useServerFn(pokeVirtualComputer);
  const stop = useServerFn(stopVirtualComputer);
  const sendSecret = useServerFn(sendVirtualComputerSecret);
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const pokedFor = useRef<string | null>(null);

  const { data: run, refetch } = useQuery({
    queryKey: ["vc-active-run", threadId],
    refetchInterval: 3000,
    queryFn: async (): Promise<Run | null> => {
      let q = supabase
        .from("vc_runs")
        .select("id, status, phase_text, live_view_url, result, error, secret_request, thread_id, created_at")
        .in("status", ACTIVE)
        .order("created_at", { ascending: false })
        .limit(1);
      if (threadId) q = q.eq("thread_id", threadId);
      const { data } = await q;
      return ((data?.[0] as Run | undefined) ?? null) as Run | null;
    },
  });

  // While the card is open, push the run forward faster than the minute tick.
  useEffect(() => {
    if (!run || !ACTIVE.includes(run.status)) return;
    const id = window.setInterval(() => {
      void poke({ data: { runId: run.id } }).then(() => refetch());
    }, 6000);
    if (pokedFor.current !== run.id) {
      pokedFor.current = run.id;
      void poke({ data: { runId: run.id } }).then(() => refetch());
    }
    return () => window.clearInterval(id);
  }, [run?.id, run?.status]);

  const phase = useMemo(() => {
    if (!run) return "";
    if (run.status === "awaiting_secret")
      return run.secret_request?.ask ?? "Waiting for a password or code";
    return run.phase_text ?? "Working…";
  }, [run]);

  if (!run) return null;

  const awaiting = run.status === "awaiting_secret";

  return (
    <div className="mb-2 rounded-2xl border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold">Virtual computer</span>
        {!awaiting && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> cloud only
        </span>
      </div>

      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">{phase}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {run.live_view_url && (
          <a
            href={run.live_view_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Watch it work
          </a>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 rounded-full px-3 text-[11px]"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await stop({ data: { runId: run.id } });
              toast("🛑");
              await refetch();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Square className="mr-1 h-3 w-3" /> Stop
        </Button>
      </div>

      {awaiting && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <Lock className="h-3 w-3 text-muted-foreground" />
            <Input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                run.secret_request?.kind === "code"
                  ? "Verification code"
                  : `Password for ${run.secret_request?.domain ?? "the site"}`
              }
              className="h-9 flex-1 text-sm"
            />
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-full px-3 text-[11px]"
              disabled={busy || !secret.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const res: any = await sendSecret({
                    data: { runId: run.id, value: secret, remember },
                  });
                  if (res?.ok) {
                    setSecret("");
                    toast("🔐");
                    await refetch();
                  } else {
                    toast.error(res?.error ?? "That didn't go through");
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send
            </Button>
          </div>
          {run.secret_request?.kind !== "code" && (
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3 w-3"
              />
              Remember this login so I'm not asked again
            </label>
          )}
          <p className="text-[10px] leading-snug text-muted-foreground">
            Typed straight into the page. Orby never sees it and it never appears in this chat.
          </p>
        </div>
      )}
    </div>
  );
}
