import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Backstop poller for fal queue jobs (videos). The plan runner polls anything
// it's actively waiting on, but user-initiated videos (Image-to-Video dialog,
// etc.) stall if the user closes the tab — this drains those too.
const MAX_PER_TICK = 12;
const MIN_AGE_MS = 15_000;

async function pollOne(rowId: string, userId: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET!;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/poll-video-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        row_id: rowId,
        user_id: userId,
        internal_secret: PLAN_TICK_SECRET,
      }),
    });
    return { row_id: rowId, status: res.status };
  } catch (err) {
    return { row_id: rowId, status: 0, error: String((err as any)?.message ?? err) };
  }
}

export const Route = createFileRoute("/api/public/media-poll-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anonKey =
          process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const sentKey =
          request.headers.get("apikey") ?? request.headers.get("Apikey");
        const PLAN_TICK_SECRET = process.env.PLAN_TICK_SECRET;
        const sentSecret = request.headers.get("x-plan-tick-secret");
        const authed =
          (anonKey && sentKey === anonKey) ||
          (PLAN_TICK_SECRET && sentSecret === PLAN_TICK_SECRET);
        if (!authed) return new Response("unauthorized", { status: 401 });

        const ageCutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
        const { data: rows, error } = await supabaseAdmin
          .from("media_assets")
          .select("id, user_id")
          .eq("status", "generating")
          .not("fal_status_url", "is", null)
          .lt("created_at", ageCutoff)
          .order("created_at", { ascending: true })
          .limit(MAX_PER_TICK);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const results = await Promise.all(
          (rows ?? []).map((r) => pollOne(r.id, r.user_id)),
        );
        return Response.json({ ok: true, polled: results.length, results });
      },
      GET: async () => {
        const { count } = await supabaseAdmin
          .from("media_assets")
          .select("id", { count: "exact", head: true })
          .eq("status", "generating")
          .not("fal_status_url", "is", null);
        return Response.json({ ok: true, queued: count ?? 0 });
      },
    },
  },
});
