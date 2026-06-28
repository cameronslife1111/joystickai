import { createClient } from "npm:@supabase/supabase-js@^2.45.0";

const FAL_KEY = Deno.env.get("FAL_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Pull whatever signal we can out of a fal client error. The SDK sometimes
// attaches `.body` / `.status` / a nested response; bare `err.message` like
// "Internal Server Error" is useless to the planner.
function extractFalError(err: any): string {
  const base = String(err?.message ?? err ?? "Generation failed");
  const body = err?.body ?? err?.response?.body ?? err?.responseBody;
  if (!body) return base;
  try {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    if (detail && !base.includes(detail)) return `${base}: ${detail.slice(0, 500)}`;
  } catch { /* fall through */ }
  return base;
}

function isTransientFalError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === "number") return status >= 500 || status === 408 || status === 429;
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    msg.includes("internal server error") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout") ||
    msg.includes("service unavailable") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

// Submit to fal's queue (instead of fal.subscribe). The queue returns a
// status_url / response_url immediately; the row stores those and the shared
// poller (poll-video-job, kind-aware) drives it to completion. This survives
// the edge worker being cut off mid-generation — the old subscribe pattern
// left rows stuck in "generating" forever when the background task died.
async function submitToQueueWithRetry(
  modelId: string,
  input: Record<string, unknown>,
): Promise<{ status_url: string; response_url: string; request_id?: string }> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`https://queue.fal.run/${modelId}`, {
        method: "POST",
        headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const t = await res.text();
        const err: any = new Error(`fal submit ${res.status}: ${t.slice(0, 400)}`);
        err.status = res.status;
        throw err;
      }
      const queued = await res.json();
      if (!queued.status_url || !queued.response_url) {
        throw new Error("fal queue returned no status/response url");
      }
      return {
        status_url: queued.status_url,
        response_url: queued.response_url,
        request_id: queued.request_id,
      };
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransientFalError(err)) throw err;
      const backoffMs = 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
      console.warn(`fal transient error on attempt ${attempt}: ${String((err as any)?.message ?? err)}; retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  // Two callers: app users (Authorization JWT) and the internal plan-tick
  // cron (PLAN_TICK_SECRET + user_id in the body).
  const PLAN_TICK_SECRET = Deno.env.get("PLAN_TICK_SECRET") ?? "";
  let user: { id: string };
  if (body?.internal_secret && body.internal_secret === PLAN_TICK_SECRET && typeof body?.user_id === "string") {
    user = { id: body.user_id };
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    user = { id: userData.user.id };
  }
  const { row_id, prompt, image_size, quality, output_format } = body ?? {};
  if (typeof row_id !== "string") return json({ error: "row_id required" }, 400);
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return json({ error: "prompt required" }, 400);
  }

  const validSizes = ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"];
  const finalSize = validSizes.includes(image_size) ? image_size : "portrait_16_9";

  const validQuality = ["low", "medium", "high"];
  const finalQuality = validQuality.includes(quality) ? quality : "high";

  const validFormat = ["jpeg", "png", "webp"];
  const finalFormat = validFormat.includes(output_format) ? output_format : "png";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const modelId = "openai/gpt-image-2";

  // @ts-ignore EdgeRuntime is a global in Supabase Edge Functions
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        // fal's openai/gpt-image-2 occasionally returns a transient 5xx
        // ("Internal Server Error") on otherwise valid prompts; retry the
        // submit a few times with backoff before giving up.
        const queued = await submitToQueueWithRetry(modelId, {
          prompt,
          image_size: finalSize,
          quality: finalQuality,
          num_images: 1,
          output_format: finalFormat,
        });

        // Hand off to the shared poller. The result is completed and stored by
        // poll-video-job (kind-aware) — both the foreground client hook and the
        // backstop cron poll these rows by fal_status_url.
        await admin
          .from("media_assets")
          .update({
            fal_model_id: modelId,
            fal_request_id: queued.request_id ?? null,
            fal_status_url: queued.status_url,
            fal_response_url: queued.response_url,
          })
          .eq("id", row_id)
          .eq("user_id", user.id);
      } catch (err: any) {
        await admin
          .from("media_assets")
          .update({
            status: "failed",
            error_message: extractFalError(err),
          })
          .eq("id", row_id)
          .eq("user_id", user.id);
      }
    })(),
  );

  return json({ ok: true });
});
