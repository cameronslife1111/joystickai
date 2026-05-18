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

function extractVideoUrl(result: any): string | null {
  return (
    result?.video?.url ??
    result?.output?.video?.url ??
    result?.data?.video?.url ??
    result?.data?.output?.video?.url ??
    result?.url ??
    result?.video_url ??
    null
  );
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
  const { row_id } = body ?? {};
  if (typeof row_id !== "string") return json({ error: "row_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row, error: rowErr } = await admin
    .from("media_assets")
    .select("id, user_id, status, fal_status_url, fal_response_url, kind, generation_params")
    .eq("id", row_id)
    .eq("user_id", user.id)
    .single();
  if (rowErr || !row) return json({ error: "not found" }, 404);
  if (row.status !== "generating" || !row.fal_status_url || !row.fal_response_url) {
    return json({ status: row.status?.toUpperCase() ?? "UNKNOWN" });
  }

  const statusRes = await fetch(row.fal_status_url, {
    headers: { Authorization: `Key ${FAL_KEY}` },
  });
  if (!statusRes.ok) return json({ status: "IN_PROGRESS" });
  const statusBody = await statusRes.json();

  if (statusBody.status === "FAILED") {
    const errMsg =
      statusBody.error ??
      statusBody.message ??
      JSON.stringify(statusBody).slice(0, 400);
    await admin
      .from("media_assets")
      .update({ status: "failed", error_message: String(errMsg) })
      .eq("id", row_id);
    return json({ status: "FAILED", error: String(errMsg) });
  }

  if (statusBody.status !== "COMPLETED") {
    return json({ status: "IN_PROGRESS" });
  }

  const resultRes = await fetch(row.fal_response_url, {
    headers: { Authorization: `Key ${FAL_KEY}` },
  });
  if (!resultRes.ok) {
    await admin
      .from("media_assets")
      .update({ status: "failed", error_message: `fal response fetch ${resultRes.status}` })
      .eq("id", row_id);
    return json({ status: "FAILED", error: `fal response fetch ${resultRes.status}` });
  }
  const result = await resultRes.json();
  const videoUrl = extractVideoUrl(result);
  if (!videoUrl) {
    await admin
      .from("media_assets")
      .update({ status: "failed", error_message: "fal completed but no video url" })
      .eq("id", row_id);
    return json({ status: "FAILED", error: "fal completed but no video url" });
  }

  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`download failed: ${videoRes.status}`);
    const videoBuffer = new Uint8Array(await videoRes.arrayBuffer());
    const storagePath = `${user.id}/${Date.now()}_generated.mp4`;
    const mimeType = "video/mp4";

    const { error: uploadErr } = await admin.storage
      .from("joystick-media")
      .upload(storagePath, videoBuffer, { contentType: mimeType, upsert: false });
    if (uploadErr) throw new Error(`upload failed: ${uploadErr.message}`);

    const { data: pub } = admin.storage.from("joystick-media").getPublicUrl(storagePath);

    await admin
      .from("media_assets")
      .update({
        status: "completed",
        url: pub.publicUrl,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: videoBuffer.byteLength,
      })
      .eq("id", row_id);

    return json({ status: "COMPLETED", url: pub.publicUrl });
  } catch (err: any) {
    await admin
      .from("media_assets")
      .update({ status: "failed", error_message: String(err?.message ?? err) })
      .eq("id", row_id);
    return json({ status: "FAILED", error: String(err?.message ?? err) });
  }
});
