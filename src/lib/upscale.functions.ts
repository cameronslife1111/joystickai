import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  sourceAssetId: z.string().uuid(),
  imageUrl: z.string().url(),
  title: z.string().min(1).max(300),
  upscaleFactor: z.number().min(1.5).max(4),
  outputFormat: z.enum(["jpeg", "png"]).default("jpeg"),
  faceEnhancement: z.boolean().default(true),
  enhancementStrength: z.enum(["low", "medium", "high"]).nullable().default(null),
});

const MODEL_ID = "topaz/upscale/image/generative";

/**
 * Starts a Topaz generative upscale (Wonder 3.5) on fal's queue and records the
 * status/response urls on a new media_assets row. The existing image-aware
 * poller downloads the result and flips the row to "completed".
 */
export const startImageUpscale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const falKey = process.env.FAL_KEY;
    if (!falKey) throw new Error("Missing FAL_KEY");

    const factor = Math.min(4, Math.max(1.5, Math.round(data.upscaleFactor * 2) / 2));

    const { data: row, error } = await context.supabase
      .from("media_assets")
      .insert({
        user_id: context.userId,
        title: data.title,
        kind: "image",
        status: "generating",
        generation_params: {
          mode: "upscale",
          model: "Wonder 3.5",
          upscale_factor: factor,
          output_format: data.outputFormat,
          face_enhancement: data.faceEnhancement,
          enhancement_strength: data.enhancementStrength,
          source_asset_id: data.sourceAssetId,
        },
      } as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not create the media row");

    const rowId = (row as { id: string }).id;

    try {
      const res = await fetch(`https://queue.fal.run/${MODEL_ID}`, {
        method: "POST",
        headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: data.imageUrl,
          model: "Wonder 3.5",
          upscale_factor: factor,
          output_format: data.outputFormat,
          face_enhancement: data.faceEnhancement,
          ...(data.enhancementStrength ? { enhancement_strength: data.enhancementStrength } : {}),
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`fal submit ${res.status}: ${t.slice(0, 500)}`);
      }
      const queued = (await res.json()) as {
        request_id?: string;
        status_url?: string;
        response_url?: string;
      };
      if (!queued.status_url || !queued.response_url) {
        throw new Error("fal queue returned no status/response url");
      }

      await context.supabase
        .from("media_assets")
        .update({
          fal_model_id: MODEL_ID,
          fal_request_id: queued.request_id ?? null,
          fal_status_url: queued.status_url,
          fal_response_url: queued.response_url,
        } as never)
        .eq("id", rowId);

      return { id: rowId };
    } catch (err) {
      const detail = String((err as Error)?.message ?? err ?? "Upscale failed");
      await context.supabase
        .from("media_assets")
        .update({ status: "failed", error_message: detail } as never)
        .eq("id", rowId);
      throw new Error(detail);
    }
  });
