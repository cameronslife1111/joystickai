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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const user = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const {
    row_id,
    image_url,
    audio_url,
    talking_style,
    resolution,
    aspect_ratio,
    caption,
  } = body ?? {};

  if (typeof row_id !== "string") return json({ error: "row_id required" }, 400);
  if (typeof image_url !== "string") return json({ error: "image_url required" }, 400);
  if (typeof audio_url !== "string") return json({ error: "audio_url required" }, 400);

  const validTalkingStyle = ["stable", "expressive"];
  const finalTalkingStyle = validTalkingStyle.includes(talking_style) ? talking_style : "stable";

  const validResolution = ["360p", "480p", "540p", "720p", "1080p"];
  const finalResolution = validResolution.includes(resolution) ? resolution : "1080p";

  const validAspect = ["16:9", "9:16", "1:1"];
  const finalAspect = validAspect.includes(aspect_ratio) ? aspect_ratio : "9:16";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const hostedImage = await hostOnFal(image_url);
    const hostedAudio = await hostOnFal(audio_url);

    const modelId = "fal-ai/heygen/avatar4/image-to-video";
    const falBody: any = {
      image_url: hostedImage,
      audio_url: hostedAudio,
      talking_style: finalTalkingStyle,
      resolution: finalResolution,
      aspect_ratio: finalAspect,
    };
    if (typeof caption === "boolean") falBody.caption = caption;

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
