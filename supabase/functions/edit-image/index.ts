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
  const { row_id, prompt, image_urls, image_size, quality, output_format } = body ?? {};
  if (typeof row_id !== "string") return json({ error: "row_id required" }, 400);
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return json({ error: "prompt required" }, 400);
  }
  if (!Array.isArray(image_urls) || image_urls.length < 1 || image_urls.length > 16) {
    return json({ error: "image_urls must be an array of 1 to 16 URLs" }, 400);
  }
  if (!image_urls.every((u) => typeof u === "string" && /^https?:\/\//.test(u))) {
    return json({ error: "image_urls must all be http(s) URLs" }, 400);
  }

  const validSizes = ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9", "auto"];
  const finalSize = validSizes.includes(image_size) ? image_size : "portrait_16_9";

  const validQuality = ["low", "medium", "high"];
  const finalQuality = validQuality.includes(quality) ? quality : "high";

  const validFormat = ["jpeg", "png", "webp"];
  const finalFormat = validFormat.includes(output_format) ? output_format : "png";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // @ts-ignore EdgeRuntime is a global in Supabase Edge Functions
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const result = await fal.subscribe("openai/gpt-image-2/edit", {
          input: {
            prompt,
            image_urls,
            image_size: finalSize,
            quality: finalQuality,
            num_images: 1,
            output_format: finalFormat,
          },
          logs: false,
        });

        const img = result.data?.images?.[0];
        if (!img?.url) throw new Error("fal returned no image");

        const imgRes = await fetch(img.url);
        if (!imgRes.ok) throw new Error(`download failed: ${imgRes.status}`);
        const imgBuffer = new Uint8Array(await imgRes.arrayBuffer());

        const storagePath = `${user.id}/${Date.now()}_edited.${finalFormat}`;
        const mimeType = `image/${finalFormat === "jpeg" ? "jpeg" : finalFormat}`;

        const { error: uploadErr } = await admin.storage
          .from("joystick-media")
          .upload(storagePath, imgBuffer, { contentType: mimeType, upsert: false });
        if (uploadErr) throw new Error(`upload failed: ${uploadErr.message}`);

        const { data: pub } = admin.storage.from("joystick-media").getPublicUrl(storagePath);

        await admin
          .from("media_assets")
          .update({
            status: "completed",
            url: pub.publicUrl,
            storage_path: storagePath,
            mime_type: mimeType,
            width: img.width ?? null,
            height: img.height ?? null,
            size_bytes: imgBuffer.byteLength,
          })
          .eq("id", row_id)
          .eq("user_id", user.id);
      } catch (err: any) {
        // fal errors carry the API response body on err.body — surface it so
        // planners (and the AI Plans UI) see the real reason instead of a
        // generic "Unprocessable Entity".
        let detail = String(err?.message ?? err ?? "Generation failed");
        const body = err?.body ?? err?.response?.body;
        if (body) {
          try {
            const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
            if (bodyStr && bodyStr !== "{}") detail += ` — ${bodyStr.slice(0, 500)}`;
          } catch { /* ignore */ }
        }
        await admin
          .from("media_assets")
          .update({ status: "failed", error_message: detail })
          .eq("id", row_id)
          .eq("user_id", user.id);
      }
    })(),
  );

  return json({ ok: true });
});
