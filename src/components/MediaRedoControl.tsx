import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { useVoiceDictation, appendTranscript } from "@/lib/use-voice-dictation";
import { rewriteMediaPrompt } from "@/lib/media-revise.functions";
import { nextRedoTitle } from "@/lib/redo-title";
import { Textarea } from "@/components/ui/textarea";

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
  onOpenChange?: (open: boolean) => void;
}

/**
 * Redo -> compact typed/dictated change box -> the same regeneration pipeline
 * with the same reference media and settings as the original voice-only flow.
 */
export function MediaRedoControl({ asset, onDone, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const [change, setChange] = useState("");
  const [working, setWorking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rewrite = useServerFn(rewriteMediaPrompt);

  const focusComposerEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }, []);

  const handleDictationText = useCallback(
    (text: string) => {
      setChange((current) => appendTranscript(current, text));
      focusComposerEnd();
    },
    [focusComposerEnd],
  );

  const dictation = useVoiceDictation(handleDictationText);
  const cancelDictation = dictation.cancel;

  const setComposerOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) cancelDictation();
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
      if (nextOpen) focusComposerEnd();
    },
    [cancelDictation, focusComposerEnd, onOpenChange],
  );

  // Never leave the mic active when the viewed asset changes or this control unmounts.
  useEffect(() => cancelDictation, [cancelDictation]);
  useEffect(() => {
    cancelDictation();
    setOpen(false);
    setChange("");
    onOpenChange?.(false);
    // Intentionally keyed only by asset changes; callback identity is stable at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, cancelDictation]);

  // Keep the compact input auto-growing up to roughly three lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !open) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [change, open]);

  const submit = useCallback(
    async (requestedChange: string) => {
      const revisionText = requestedChange.trim();
      if (!revisionText) return;
      setWorking(true);
      try {
        const params = (asset.generation_params ?? {}) as Record<string, unknown>;
        const mode = str(params.mode) ?? (asset.kind === "video" ? "image-to-video" : "text-to-image");
        const original = str(params.user_text) ?? asset.title ?? "";
        const isVideo = asset.kind === "video";

        const { prompt } = await rewrite({
          data: {
            originalPrompt: original,
            change: revisionText,
            kind: isVideo ? "video" : "image",
            mode: isVideo ? "rewrite" : "edit",
          },
        });

        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Not signed in");

        const baseParams: Record<string, unknown> = {
          ...params,
          user_text: prompt,
          revised_from_asset_id: asset.id,
          revision_text: revisionText,
        };

        const redoTitle = await nextRedoTitle(asset.title);

        const insertRow = async (kind: string) => {
          const { data: row, error } = await supabase
            .from("media_assets")
            .insert({
              user_id: u.user!.id,
              title: redoTitle,
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
          // Always remix the image being previewed: it is the first reference,
          // followed by the original reference images so faces/style survive.
          const refIds = Array.isArray(params.source_asset_ids)
            ? (params.source_asset_ids as unknown[]).filter((v): v is string => typeof v === "string")
            : [];
          const singleRef = str(params.source_asset_id);
          if (singleRef) refIds.push(singleRef);

          const urls: string[] = [];
          const usedIds: string[] = [];
          if (asset.url) {
            urls.push(asset.url);
            usedIds.push(asset.id);
          }
          for (const id of refIds) {
            if (usedIds.includes(id)) continue;
            const u2 = await urlOf(id);
            if (u2 && !urls.includes(u2)) {
              urls.push(u2);
              usedIds.push(id);
            }
            if (urls.length >= 16) break;
          }

          const imageSize = str(params.image_size) ?? "portrait_16_9";
          const quality = str(params.quality) ?? "high";

          if (urls.length > 0) {
            baseParams.mode = "voice-remix";
            baseParams.source_asset_ids = usedIds;
            const row = await insertRow("image");
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
            const row = await insertRow("image");
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

        toast(isVideo ? "Regenerating your video..." : "Remixing your image...", {
          description: "It'll appear in the gallery when ready.",
        });
        setChange("");
        setComposerOpen(false);
        onDone();
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to start regeneration");
      } finally {
        setWorking(false);
      }
    },
    [asset, onDone, rewrite, setComposerOpen],
  );

  const busy = working || dictation.transcribing;
  const canSubmit = !busy && !dictation.recording && change.trim().length > 0;

  const submitCurrent = useCallback(() => {
    if (!canSubmit) return;
    void submit(change);
  }, [canSubmit, change, submit]);

  if (!open) {
    return (
      <div
        className="absolute left-4 z-20"
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          aria-label={`Redo this ${asset.kind === "video" ? "video" : "image"}`}
          className="flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium text-foreground shadow-lg backdrop-blur transition active:scale-95 hover:bg-background/85"
        >
          <RefreshCw className="h-4 w-4" />
          Redo
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-x-4 z-20 mx-auto max-w-2xl"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          if (!working) setComposerOpen(false);
        }
      }}
    >
      <div className="flex items-end gap-2 rounded-3xl border border-border/60 bg-background/80 p-2 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setComposerOpen(false)}
          disabled={working}
          aria-label="Close redo composer"
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>

        <Textarea
          ref={textareaRef}
          value={change}
          onChange={(e) => setChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submitCurrent();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (!working) setComposerOpen(false);
            }
          }}
          placeholder="What should change?"
          rows={1}
          disabled={busy}
          aria-label="Describe the redo change"
          className="max-h-24 min-h-11 flex-1 resize-none overflow-y-auto rounded-2xl border-input bg-background/70 px-3 py-2.5 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
        />

        <button
          type="button"
          onClick={() => void dictation.toggle()}
          disabled={working || dictation.transcribing}
          aria-label={dictation.recording ? "Stop voice input" : "Start voice input"}
          aria-pressed={dictation.recording}
          title={dictation.recording ? "Stop and transcribe" : "Voice input"}
          className={
            "flex h-11 w-11 shrink-0 items-center justify-center border transition active:scale-95 disabled:opacity-60 " +
            (dictation.recording
              ? "rounded-xl border-border bg-background text-foreground"
              : "rounded-full border-destructive/60 bg-destructive text-destructive-foreground")
          }
        >
          {dictation.transcribing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : dictation.recording ? (
            <span className="h-4 w-4 rounded-sm bg-foreground" />
          ) : (
            <span className="h-4 w-4 rounded-full bg-destructive-foreground" />
          )}
        </button>

        <button
          type="button"
          onClick={submitCurrent}
          disabled={!canSubmit}
          aria-label={`Redo this ${asset.kind === "video" ? "video" : "image"}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
