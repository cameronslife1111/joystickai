import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { useVoiceDictation } from "@/lib/use-voice-dictation";
import { rewriteMediaPrompt } from "@/lib/media-revise.functions";

type Params = Record<string, unknown> | null | undefined;

export interface ReviseAsset {
  id: string;
  title: string;
  kind: string;
  url: string | null;
  status?: string | null;
  generation_params?: Params;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

async function urlOf(id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase.from("media_assets").select("url").eq("id", id).maybeSingle();
  return (data?.url as string | null) ?? null;
}

interface Props {
  asset: ReviseAsset;
  onDone: () => void;
}

/**
 * Red circle -> tap to record what should change -> black square -> tap to
 * transcribe, rewrite the prompt, and kick off the same generation pipeline
 * with the same reference media and settings.
 */
export function VoiceReviseButton({ asset, onDone }: Props) {
  const [working, setWorking] = useState(false);
  const rewrite = useServerFn(rewriteMediaPrompt);

  const submit = useCallback(
    async (spoken: string) => {
      setWorking(true);
      try {
        const params = (asset.generation_params ?? {}) as Record<string, unknown>;
        const mode = str(params.mode) ?? (asset.kind === "video" ? "image-to-video" : "text-to-image");
        const original = str(params.user_text) ?? asset.title ?? "";
        const isVideo = asset.kind === "video";

        const { prompt } = await rewrite({
          data: { originalPrompt: original, change: spoken, kind: isVideo ? "video" : "image" },
        });

        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Not signed in");

        const baseParams: Record<string, unknown> = {
          ...params,
          user_text: prompt,
          revised_from_asset_id: asset.id,
          revision_text: spoken,
        };

        const insertRow = async (kind: string) => {
          const { data: row, error } = await supabase
            .from("media_assets")
            .insert({
              user_id: u.user!.id,
              title: prompt.slice(0, 60) || asset.title || "Revised media",
              kind,
              status: "generating",
              generation_params: baseParams,
            } as any)
            .select()
            .single();
          if (error || !row) throw error ?? new Error("Failed to create row");
          return row as { id: string };
        };

        if (isVideo) {
          const sourceImageUrl = await urlOf(str(params.source_image_id));
          if (!sourceImageUrl) throw new Error("The original source image for this video is unavailable");

          if (mode === "audio-image-to-video") {
            const audioUrl = await urlOf(str(params.audio_asset_id));
            if (!audioUrl) throw new Error("The original audio clip is unavailable");
            const row = await insertRow("video");
            const { error } = await supabase.functions.invoke("generate-heygen-avatar", {
              body: {
                row_id: row.id,
                image_url: sourceImageUrl,
                audio_url: audioUrl,
                talking_style: str(params.talking_style) ?? "stable",
                resolution: str(params.resolution) ?? "1080p",
                aspect_ratio: str(params.aspect_ratio) ?? "9:16",
                caption: bool(params.caption) ?? false,
              },
            });
            if (error) throw error;
          } else if (mode === "video-to-video") {
            const videoUrl = await urlOf(str(params.reference_video_id));
            if (!videoUrl) throw new Error("The original reference video is unavailable");
            const elementUrl = await urlOf(str(params.element_image_id));
            const row = await insertRow("video");
            const { error } = await supabase.functions.invoke("generate-kling-video", {
              body: {
                row_id: row.id,
                mode: "v2v",
                prompt,
                image_url: sourceImageUrl,
                video_url: videoUrl,
                character_orientation: str(params.character_orientation) ?? "image",
                keep_original_sound: bool(params.keep_original_sound) ?? false,
                element_image_url: elementUrl,
              },
            });
            if (error) throw error;
          } else {
            const endUrl = await urlOf(str(params.end_image_id));
            const row = await insertRow("video");
            const { error } = await supabase.functions.invoke("generate-kling-video", {
              body: {
                row_id: row.id,
                mode: "i2v",
                prompt,
                image_url: sourceImageUrl,
                end_image_url: endUrl,
                duration: num(params.duration) ?? str(params.duration) ?? 5,
                generate_audio: bool(params.generate_audio) ?? true,
                negative_prompt: str(params.negative_prompt) ?? "",
                cfg_scale: num(params.cfg_scale) ?? 0.5,
              },
            });
            if (error) throw error;
          }
        } else {
          const refIds = Array.isArray(params.source_asset_ids)
            ? (params.source_asset_ids as unknown[]).filter((v): v is string => typeof v === "string")
            : [];
          const urls: string[] = [];
          for (const id of refIds) {
            const u2 = await urlOf(id);
            if (u2) urls.push(u2);
          }
          if (urls.length === 0 && asset.url) urls.push(asset.url);

          const imageSize = str(params.image_size) ?? "portrait_16_9";
          const quality = str(params.quality) ?? "high";
          const row = await insertRow("image");

          if (urls.length > 0) {
            const { error } = await supabase.functions.invoke("edit-image", {
              body: {
                row_id: row.id,
                prompt,
                image_urls: urls,
                image_size: imageSize,
                quality,
                output_format: "png",
              },
            });
            if (error) throw error;
          } else {
            const { error } = await supabase.functions.invoke("generate-image", {
              body: {
                row_id: row.id,
                prompt,
                image_size: imageSize,
                quality,
                output_format: "png",
              },
            });
            if (error) throw error;
          }
        }

        toast(isVideo ? "Regenerating your video..." : "Regenerating your image...", {
          description: "It'll appear in the gallery when ready.",
        });
        onDone();
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to start regeneration");
      } finally {
        setWorking(false);
      }
    },
    [asset, onDone, rewrite],
  );

  const dictation = useVoiceDictation(
    useCallback((text: string) => { void submit(text); }, [submit]),
  );

  const busy = working || dictation.transcribing;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!busy) void dictation.toggle(); }}
      disabled={busy}
      aria-label={dictation.recording ? "Stop and regenerate" : "Say what to change"}
      className={
        "flex h-10 w-10 items-center justify-center border border-white/20 text-white transition active:scale-95 " +
        (dictation.recording
          ? "rounded-lg bg-black"
          : "rounded-full bg-red-600 animate-none")
      }
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : dictation.recording ? (
        <span className="h-4 w-4 rounded-sm bg-white/90" />
      ) : (
        <span className="h-4 w-4 rounded-full bg-white/90" />
      )}
    </button>
  );
}
