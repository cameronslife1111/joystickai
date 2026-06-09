import { useEffect, useState } from "react";
import { Paperclip, X, Library, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { supabase } from "@/integrations/supabase/client";
import { assembleImagePrompt } from "@/lib/media-prompt";
import { toProxiedMediaUrl } from "@/lib/sb-proxy.client";

interface SourceImage {
  id: string;
  url: string | null;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceImage: SourceImage;
  onSubmitted?: () => void;
}

type Orientation = "image" | "video";

const ORIENTATION_LIMIT: Record<Orientation, number> = { image: 10, video: 30 };

export function VideoToVideoDialog({ open, onOpenChange, sourceImage, onSubmitted }: Props) {
  const [prompt, setPrompt] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [refVideo, setRefVideo] = useState<MediaAsset | null>(null);
  const [refVideoDuration, setRefVideoDuration] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("image");
  const [keepSound, setKeepSound] = useState(true);
  const [elementImage, setElementImage] = useState<MediaAsset | null>(null);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [videoPickerOpen, setVideoPickerOpen] = useState(false);
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPrompt("");
    setDocIds([]);
    setRefVideo(null);
    setRefVideoDuration(null);
    setOrientation("image");
    setKeepSound(true);
    setElementImage(null);
  };

  // Load duration if not on the asset row
  useEffect(() => {
    if (!refVideo) { setRefVideoDuration(null); return; }
    const known = (refVideo as any).duration_seconds as number | null | undefined;
    if (typeof known === "number" && known > 0) {
      setRefVideoDuration(known);
      return;
    }
    if (!refVideo.url) { setRefVideoDuration(null); return; }
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      setRefVideoDuration(isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => setRefVideoDuration(null);
    v.src = toProxiedMediaUrl(refVideo.url) ?? "";
  }, [refVideo]);

  const overLimit =
    refVideoDuration !== null && refVideoDuration > ORIENTATION_LIMIT[orientation];

  const canSubmit =
    !submitting &&
    !!refVideo &&
    (prompt.trim().length > 0 || docIds.length > 0);

  const handleGenerate = async () => {
    if (!sourceImage.url) { toast.error("Source image is missing a URL"); return; }
    if (!refVideo?.url) { toast.error("Pick a reference video first"); return; }
    setSubmitting(true);
    try {
      const finalPrompt = await assembleImagePrompt(prompt, docIds);
      if (!finalPrompt.trim()) throw new Error("Prompt is empty");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      const { data: row, error } = await supabase
        .from("media_assets")
        .insert({
          user_id: u.user.id,
          title: prompt.trim().slice(0, 60) || "Generated video",
          kind: "video",
          status: "generating",
          generation_params: {
            mode: "video-to-video",
            model: "kling-v3-pro-motion-control",
            source_image_id: sourceImage.id,
            reference_video_id: refVideo.id,
            character_orientation: orientation,
            keep_original_sound: keepSound,
            element_image_id: elementImage?.id ?? null,
            user_text: prompt,
            document_ids: docIds,
          },
        } as any)
        .select()
        .single();
      if (error || !row) throw error ?? new Error("Failed to create row");

      const { error: fnErr } = await supabase.functions.invoke("generate-kling-video", {
        body: {
          row_id: row.id,
          mode: "v2v",
          prompt: finalPrompt,
          image_url: sourceImage.url,
          video_url: refVideo.url,
          character_orientation: orientation,
          keep_original_sound: keepSound,
          element_image_url:
            orientation === "video" && elementImage ? elementImage.url : null,
        },
      });
      if (fnErr) throw fnErr;

      onOpenChange(false);
      reset();
      onSubmitted?.();
      toast("Generating video...", { description: "It can take a few minutes." });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start generation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Video to Video</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            The motion from your reference video will be applied to a character or scene that matches this image.
          </p>
          <div className="flex flex-col gap-4">
            {/* Source */}
            <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                {sourceImage.url && (
                  <img src={sourceImage.url} alt={sourceImage.title} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Appearance reference</p>
                <p className="truncate text-sm">{sourceImage.title}</p>
              </div>
            </div>

            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the scene or action..."
              rows={3}
              className="max-h-48 min-h-[80px] resize-y"
            />

            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDocPickerOpen(true)}>
                <Paperclip className="mr-2 h-4 w-4" /> Attach documents
              </Button>
              {docIds.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {docIds.map((id) => (
                    <DocChip key={id} id={id} onRemove={() => setDocIds((cur) => cur.filter((x) => x !== id))} />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Reference video (motion source)</Label>
              {refVideo ? (
                <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                    {refVideo.url && (
                      <video src={refVideo.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    )}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm">{refVideo.title}</p>
                  <Button size="sm" variant="ghost" onClick={() => setVideoPickerOpen(true)}>Change</Button>
                  <button
                    type="button"
                    onClick={() => setRefVideo(null)}
                    aria-label="Remove reference video"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setVideoPickerOpen(true)}>
                  <Library className="mr-2 h-4 w-4" /> Choose video from gallery
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                The character's motion in the output will match this video. Should contain a clear character (head + body visible, no occlusion).
              </p>
              {overLimit && (
                <p className="text-xs text-destructive">
                  Your reference video is longer than the {ORIENTATION_LIMIT[orientation]}s limit for this orientation. It may be trimmed or rejected.
                </p>
              )}
            </div>

            <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Motion options
            </p>

            <div className="flex flex-col gap-1.5">
              <Label>Character orientation</Label>
              <Select value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Match reference image — better for camera moves (≤10s)</SelectItem>
                  <SelectItem value="video">Match reference video — better for complex motion (≤30s)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3">
              <div>
                <Label className="text-sm">Keep original sound</Label>
                <p className="text-xs text-muted-foreground">Carry audio from the reference video into the output.</p>
              </div>
              <Switch checked={keepSound} onCheckedChange={setKeepSound} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Facial element (optional)</Label>
              {orientation !== "video" ? (
                <p className="text-xs text-muted-foreground">
                  Available only when orientation is 'Match reference video'.
                </p>
              ) : elementImage ? (
                <>
                  <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                      {elementImage.url && (
                        <img src={elementImage.url} alt={elementImage.title} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm">{elementImage.title}</p>
                    <Button size="sm" variant="ghost" onClick={() => setElementPickerOpen(true)}>Change</Button>
                    <button
                      type="button"
                      onClick={() => setElementImage(null)}
                      aria-label="Remove element image"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Improves facial identity preservation. Reference as <code>@Element1</code> in your prompt.
                  </p>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setElementPickerOpen(true)}>
                    <ImageIcon className="mr-2 h-4 w-4" /> Choose facial element image
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Improves facial identity preservation. Reference as <code>@Element1</code> in your prompt.
                  </p>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={!canSubmit}>
              {submitting ? "Starting…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentPickerSheet
        open={docPickerOpen}
        onOpenChange={setDocPickerOpen}
        initialSelectedIds={docIds}
        onConfirm={setDocIds}
      />

      <MediaGalleryPicker
        open={videoPickerOpen}
        onOpenChange={setVideoPickerOpen}
        kind="video"
        mode="single"
        initialSelectedIds={refVideo ? [refVideo.id] : []}
        onConfirm={(assets) => setRefVideo(assets[0] ?? null)}
      />

      <MediaGalleryPicker
        open={elementPickerOpen}
        onOpenChange={setElementPickerOpen}
        kind="image"
        mode="single"
        initialSelectedIds={elementImage ? [elementImage.id] : []}
        onConfirm={(assets) => setElementImage(assets[0] ?? null)}
      />
    </>
  );
}

function DocChip({ id, onRemove }: { id: string; onRemove: () => void }) {
  const [title, setTitle] = useState<string>("Document");
  useEffect(() => {
    supabase.from("documents").select("title").eq("id", id).single().then(({ data }) => {
      if (data?.title) setTitle(data.title);
    });
  }, [id]);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-2.5 py-1 text-xs">
      <span className="max-w-[160px] truncate">{title}</span>
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
