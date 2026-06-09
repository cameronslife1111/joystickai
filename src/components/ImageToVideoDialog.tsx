import { useEffect, useState } from "react";
import { Paperclip, X, Image as ImageIcon } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
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
import { proxyMediaUrl } from "@/lib/sb-proxy.client";
import { assembleImagePrompt } from "@/lib/media-prompt";

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

const DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function ImageToVideoDialog({ open, onOpenChange, sourceImage, onSubmitted }: Props) {
  const [prompt, setPrompt] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<number>(5);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [endImage, setEndImage] = useState<MediaAsset | null>(null);
  const [negativePrompt, setNegativePrompt] = useState("blur, distort, and low quality");
  const [cfgScale, setCfgScale] = useState(0.5);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [endPickerOpen, setEndPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPrompt("");
    setDocIds([]);
    setDuration(5);
    setGenerateAudio(false);
    setEndImage(null);
    setNegativePrompt("blur, distort, and low quality");
    setCfgScale(0.5);
  };

  const canSubmit = !submitting && (prompt.trim().length > 0 || docIds.length > 0);

  const handleGenerate = async () => {
    if (!sourceImage.url) {
      toast.error("Source image is missing a URL");
      return;
    }
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
            mode: "image-to-video",
            model: "kling-v3-pro-i2v",
            source_image_id: sourceImage.id,
            end_image_id: endImage?.id ?? null,
            duration,
            generate_audio: generateAudio,
            negative_prompt: negativePrompt,
            cfg_scale: cfgScale,
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
          mode: "i2v",
          prompt: finalPrompt,
          image_url: sourceImage.url,
          end_image_url: endImage?.url ?? null,
          duration,
          generate_audio: generateAudio,
          negative_prompt: negativePrompt,
          cfg_scale: cfgScale,
        },
      });
      if (fnErr) throw fnErr;

      onOpenChange(false);
      reset();
      onSubmitted?.();
      toast("Generating video...", {
        description: "It can take a few minutes.",
      });
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
            <DialogTitle>Image to Video</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {/* Source */}
            <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                {sourceImage.url && (
                  <img src={proxyMediaUrl(sourceImage.url)} alt={sourceImage.title} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Animating this image</p>
                <p className="truncate text-sm">{sourceImage.title}</p>
              </div>
            </div>

            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the motion or action..."
              rows={3}
              className="max-h-48 min-h-[80px] resize-y"
            />

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setDocPickerOpen(true)}
              >
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
              <Label>Duration</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} sec</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3">
              <div>
                <Label className="text-sm">Generate audio</Label>
                <p className="text-xs text-muted-foreground">Native speech / sound for the video.</p>
              </div>
              <Switch checked={generateAudio} onCheckedChange={setGenerateAudio} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>End image (optional)</Label>
              {endImage ? (
                <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                    {endImage.url && (
                      <img src={endImage.url} alt={endImage.title} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm">{endImage.title}</p>
                  <Button size="sm" variant="ghost" onClick={() => setEndPickerOpen(true)}>Change</Button>
                  <button
                    type="button"
                    onClick={() => setEndImage(null)}
                    aria-label="Remove end image"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setEndPickerOpen(true)}>
                  <ImageIcon className="mr-2 h-4 w-4" /> Choose end image from gallery
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Negative prompt</Label>
              <Textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
                className="resize-y"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>CFG scale</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{cfgScale.toFixed(2)}</span>
              </div>
              <Slider
                value={[cfgScale]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => setCfgScale(v[0] ?? 0.5)}
              />
              <p className="text-xs text-muted-foreground">How strictly the model follows your prompt.</p>
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
        open={endPickerOpen}
        onOpenChange={setEndPickerOpen}
        kind="image"
        mode="single"
        initialSelectedIds={endImage ? [endImage.id] : []}
        onConfirm={(assets) => setEndImage(assets[0] ?? null)}
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
