import { useState } from "react";
import { Library, Mic2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { supabase } from "@/integrations/supabase/client";
import { proxyMediaUrl } from "@/lib/sb-proxy";

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

type TalkingStyle = "stable" | "expressive";
type Resolution = "360p" | "480p" | "540p" | "720p" | "1080p";
type Aspect = "9:16" | "16:9" | "1:1";

export function AudioImageToVideoDialog({ open, onOpenChange, sourceImage, onSubmitted }: Props) {
  const [audioAsset, setAudioAsset] = useState<MediaAsset | null>(null);
  const [talkingStyle, setTalkingStyle] = useState<TalkingStyle>("stable");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [aspectRatio, setAspectRatio] = useState<Aspect>("9:16");
  const [caption, setCaption] = useState(false);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setAudioAsset(null);
    setTalkingStyle("stable");
    setResolution("1080p");
    setAspectRatio("9:16");
    setCaption(false);
  };

  const canSubmit = !submitting && !!audioAsset && !!sourceImage.url && !!audioAsset.url;

  const handleGenerate = async () => {
    if (!sourceImage.url) { toast.error("Source image is missing a URL"); return; }
    if (!audioAsset?.url) { toast.error("Pick an audio clip first"); return; }
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      const { data: row, error } = await supabase
        .from("media_assets")
        .insert({
          user_id: u.user.id,
          title: audioAsset.title ? `${audioAsset.title} (avatar)` : "Generated avatar video",
          kind: "video",
          status: "generating",
          generation_params: {
            mode: "audio-image-to-video",
            model: "heygen-avatar-v4",
            source_image_id: sourceImage.id,
            audio_asset_id: audioAsset.id,
            talking_style: talkingStyle,
            resolution,
            aspect_ratio: aspectRatio,
            caption,
          },
        } as any)
        .select()
        .single();
      if (error || !row) throw error ?? new Error("Failed to create row");

      const { error: fnErr } = await supabase.functions.invoke("generate-heygen-avatar", {
        body: {
          row_id: row.id,
          image_url: sourceImage.url,
          audio_url: audioAsset.url,
          talking_style: talkingStyle,
          resolution,
          aspect_ratio: aspectRatio,
          caption,
        },
      });
      if (fnErr) throw fnErr;

      onOpenChange(false);
      reset();
      onSubmitted?.();
      toast("Generating avatar video...", { description: "It can take a few minutes." });
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
            <DialogTitle>Audio + Image to Video</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            The face in your image will be animated to lip-sync to the audio you choose.
          </p>

          <div className="flex flex-col gap-4">
            {/* Source image */}
            <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                {sourceImage.url && (
                  <img src={proxyMediaUrl(sourceImage.url)} alt={sourceImage.title} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Face source</p>
                <p className="truncate text-sm">{sourceImage.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Make sure the image has a clear, well-lit face.
                </p>
              </div>
            </div>

            {/* Audio picker */}
            <div className="flex flex-col gap-1.5">
              <Label>Audio clip (lip-sync source)</Label>
              {audioAsset ? (
                <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-foreground/10">
                    <Mic2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm">{audioAsset.title}</p>
                  <Button size="sm" variant="ghost" onClick={() => setAudioPickerOpen(true)}>Change</Button>
                  <button
                    type="button"
                    onClick={() => setAudioAsset(null)}
                    aria-label="Remove audio clip"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAudioPickerOpen(true)}>
                  <Library className="mr-2 h-4 w-4" /> Choose audio from gallery
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Billed per second of output video.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Talking style</Label>
              <Select value={talkingStyle} onValueChange={(v) => setTalkingStyle(v as TalkingStyle)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">Stable — minimal movement</SelectItem>
                  <SelectItem value="expressive">Expressive — more animation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Resolution</Label>
              <Select value={resolution} onValueChange={(v) => setResolution(v as Resolution)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="360p">360p</SelectItem>
                  <SelectItem value="480p">480p</SelectItem>
                  <SelectItem value="540p">540p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Aspect ratio</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as Aspect)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                  <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                  <SelectItem value="1:1">Square (1:1)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3">
              <div>
                <Label className="text-sm">Captions</Label>
                <p className="text-xs text-muted-foreground">Burn captions into the video.</p>
              </div>
              <Switch checked={caption} onCheckedChange={setCaption} />
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

      <MediaGalleryPicker
        open={audioPickerOpen}
        onOpenChange={setAudioPickerOpen}
        kind="audio"
        mode="single"
        initialSelectedIds={audioAsset ? [audioAsset.id] : []}
        onConfirm={(assets) => setAudioAsset(assets[0] ?? null)}
      />
    </>
  );
}
