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

async function hostOnFal(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (/(^|\.)fal\.(media|ai|run)$/.test(u.hostname)) return url;
  } catch { /* fallthrough */ }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch source ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = contentType.includes("/") ? contentType.split("/")[1].split(";")[0] : "bin";

  const init = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, file_name: `rehost.${ext}` }),
  });
  if (!init.ok) throw new Error(`fal upload init ${init.status}`);
  const { upload_url, file_url } = await init.json();
  const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
  if (!put.ok) throw new Error(`fal upload put ${put.status}`);
  return file_url;
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
  const {
    row_id,
    mode,
    prompt,
    image_url,
    video_url,
    duration,
    generate_audio,
    end_image_url,
    negative_prompt,
    cfg_scale,
    character_orientation,
    keep_original_sound,
    element_image_url,
  } = body ?? {};

  if (typeof row_id !== "string") return json({ error: "row_id required" }, 400);
  if (mode !== "i2v" && mode !== "v2v") return json({ error: "mode must be i2v or v2v" }, 400);
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return json({ error: "prompt required" }, 400);
  }
  if (typeof image_url !== "string") return json({ error: "image_url required" }, 400);
  if (mode === "v2v" && typeof video_url !== "string") return json({ error: "video_url required for v2v" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const hostedImage = await hostOnFal(image_url);

    const modelId = mode === "i2v"
      ? "fal-ai/kling-video/v3/pro/image-to-video"
      : "fal-ai/kling-video/v3/pro/motion-control";

    const falBody: any = { prompt };

    if (mode === "i2v") {
      falBody.start_image_url = hostedImage;
      if (duration) falBody.duration = String(duration);
      if (typeof generate_audio === "boolean") falBody.generate_audio = generate_audio;
      if (end_image_url) falBody.end_image_url = await hostOnFal(end_image_url);
      if (negative_prompt) falBody.negative_prompt = negative_prompt;
      if (typeof cfg_scale === "number") falBody.cfg_scale = cfg_scale;
    } else {
      falBody.image_url = hostedImage;
      falBody.video_url = await hostOnFal(video_url);
      falBody.character_orientation = character_orientation === "video" ? "video" : "image";
      if (typeof keep_original_sound === "boolean") falBody.keep_original_sound = keep_original_sound;
      if (element_image_url && falBody.character_orientation === "video") {
        const hostedElement = await hostOnFal(element_image_url);
        falBody.elements = [{
          frontal_image_url: hostedElement,
          reference_image_urls: [hostedElement],
        }];
      }
    }

    const submit = await fetch(`https://queue.fal.run/${modelId}`, {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(falBody),
    });
    if (!submit.ok) {
      const t = await submit.text();
      throw new Error(`fal submit ${submit.status}: ${t.slice(0, 400)}`);
    }
    const queued = await submit.json();

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

    return json({ ok: true, request_id: queued.request_id });
  } catch (err: any) {
    await admin
      .from("media_assets")
      .update({
        status: "failed",
        error_message: String(err?.message ?? err ?? "submission failed"),
      })
      .eq("id", row_id)
      .eq("user_id", user.id);
    return json({ error: String(err?.message ?? err) }, 502);
  }
});
