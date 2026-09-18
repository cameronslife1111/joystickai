import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fireSchedule } from "@/lib/schedule-fire.server";

// Fairness + safety caps.
const MAX_SCHEDULES_PER_TICK = 20;
const MAX_FIRES_PER_USER_PER_TICK = 5;

export const Route = createFileRoute("/api/public/plan-scheduler-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anonKey =
          process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const sentKey =
          request.headers.get("apikey") ?? request.headers.get("Apikey");
        const sentSecret = request.headers.get("x-plan-tick-secret");
        const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET;
        const authed =
          (anonKey && sentKey === anonKey) ||
          (PLAN_TICK_SECRET && sentSecret === PLAN_TICK_SECRET);
        if (!authed) return new Response("unauthorized", { status: 401 });

        const { data: due, error } = await supabaseAdmin
          .from("plan_schedules")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", new Date().toISOString())
          .or(`claim_at.is.null,claim_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
          .order("next_run_at", { ascending: true })
          .limit(MAX_SCHEDULES_PER_TICK * 3);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Fairness cap.
        const perUser = new Map<string, number>();
        const picked: any[] = [];
        for (const s of due ?? []) {
          const used = perUser.get(s.user_id) ?? 0;
          if (used >= MAX_FIRES_PER_USER_PER_TICK) continue;
          perUser.set(s.user_id, used + 1);
          picked.push(s);
          if (picked.length >= MAX_SCHEDULES_PER_TICK) break;
        }

        // Claim atomically + fire in parallel.
        const results = await Promise.all(
          picked.map(async (s) => {
            const { data: claimed, error: claimErr } = await supabaseAdmin
              .rpc("claim_due_schedule", { p_id: s.id })
              .single();
            if (claimErr || !claimed) {
              return { id: s.id, outcome: "not_claimed" };
            }
            try {
              return await fireSchedule(claimed);
            } catch (err) {
              await supabaseAdmin
                .from("plan_schedules")
                .update({ claim_at: null })
                .eq("id", s.id);
              return {
                id: s.id,
                outcome: `error:${String((err as any)?.message ?? err)}`,
              };
            }
          }),
        );

        // This is the app's ONLY recurring scheduled job, so it also does the
        // work the old 10s/15s/20s crons used to do: rescue queued chat turns,
        // advance active plans, and poll queued video jobs. While the app is
        // open the client-side advancers keep things instant; this tick is the
        // background backstop.
        const { runStaleChatTurns } = await import("@/lib/chat-turn.server");
        const chatTurns = await runStaleChatTurns(5).catch((err) => {
          console.error("[scheduler tick] chat turn recovery failed", err);
          return [] as { id: string; outcome: string }[];
        });

        const origin = new URL(request.url).origin;
        const fanout = async (path: string) => {
          try {
            const res = await fetch(`${origin}${path}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(PLAN_TICK_SECRET ? { "x-plan-tick-secret": PLAN_TICK_SECRET } : {}),
                ...(anonKey ? { apikey: anonKey } : {}),
              },
              body: "{}",
              signal: AbortSignal.timeout(25_000),
            });
            return { path, status: res.status };
          } catch (err) {
            return { path, status: 0, error: String((err as any)?.message ?? err) };
          }
        };

        const [planTick, mediaTick] = await Promise.all([
          fanout("/api/public/plan-tick"),
          fanout("/api/public/media-poll-tick"),
        ]);

        return Response.json({
          ok: true,
          considered: due?.length ?? 0,
          fired: results.filter((r) => r.outcome === "fired").length,
          results,
          chat_turns: chatTurns,
          plan_tick: planTick,
          media_poll_tick: mediaTick,
        });


      },
      GET: async () => {
        const { count } = await supabaseAdmin
          .from("plan_schedules")
          .select("id", { count: "exact", head: true })
          .eq("enabled", true);
        return Response.json({ ok: true, enabled_schedules: count ?? 0 });
      },
    },
  },
});
