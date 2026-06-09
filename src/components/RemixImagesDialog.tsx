import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Paperclip, X } from "lucide-react";
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
import { AspectRatioSelect } from "./AspectRatioSelect";
import { QualitySelect } from "./QualitySelect";
import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { supabase } from "@/integrations/supabase/client";
import { proxyMediaUrl } from "@/lib/sb-proxy";
import { assembleImagePrompt } from "@/lib/media-prompt";

interface InitialAsset {
  id: string;
  url: string | null;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAsset: InitialAsset;
  onSubmitted?: () => void;
}

type GalleryImage = { id: string; url: string; title: string };

const MAX = 16;

export function RemixImagesDialog({ open, onOpenChange, initialAsset, onSubmitted }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([initialAsset.id]);
  const [prompt, setPrompt] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [imageSize, setImageSize] = useState("portrait_16_9");
  const [quality, setQuality] = useState("high");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedIds([initialAsset.id]);
      setPrompt("");
      setDocIds([]);
      setImageSize("portrait_16_9");
      setQuality("high");
    }
  }, [open, initialAsset.id]);

  const { data: images = [] } = useQuery({
    queryKey: ["remix_image_candidates"],
    enabled: open,
    queryFn: async (): Promise<GalleryImage[]> => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, title, kind, status")
        .eq("kind", "image")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .filter((a: any) => (a.status === null || a.status === "completed") && a.url)
        .map((a: any) => ({ id: a.id, url: a.url, title: a.title }));
    },
  });

  const selectedAssets = useMemo(
    () => selectedIds.map((id) => images.find((i) => i.id === id)).filter(Boolean) as GalleryImage[],
    [selectedIds, images],
  );

  const toggle = (id: string) => {
    if (id === initialAsset.id) return;
    setSelectedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX) {
        toast(`You can select at most ${MAX} images.`);
        return cur;
      }
      return [...cur, id];
    });
  };

  const canNext = selectedIds.length >= 2;

  const handleRemix = async () => {
    setSubmitting(true);
    try {
      const finalPrompt = await assembleImagePrompt(prompt, docIds);
      if (!finalPrompt.trim()) throw new Error("Prompt is empty");
      const urls = selectedAssets.map((a) => a.url).filter(Boolean) as string[];
      if (urls.length < 2) throw new Error("Need at least 2 images");

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      const { data: row, error } = await supabase
        .from("media_assets")
        .insert({
          user_id: u.user.id,
          title: prompt.trim().slice(0, 60) || "Remixed image",
          kind: "image",
          status: "generating",
          generation_params: {
            mode: "remix",
            user_text: prompt,
            document_ids: docIds,
            image_size: imageSize,
            quality,
            source_asset_ids: selectedIds,
          },
        } as any)
        .select()
        .single();
      if (error || !row) throw error ?? new Error("Failed to create row");

      const { error: fnErr } = await supabase.functions.invoke("edit-image", {
        body: {
          row_id: row.id,
          prompt: finalPrompt,
          image_urls: urls,
          image_size: imageSize,
          quality,
          output_format: "png",
        },
      });
      if (fnErr) throw fnErr;

      onOpenChange(false);
      onSubmitted?.();
      toast("Remixing your images...", {
        description: "It'll appear in the gallery when ready.",
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start remix");
    } finally {
      setSubmitting(false);
    }
  };

  const limitReached = selectedIds.length >= MAX;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {step === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>Select images to remix</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Choose up to 16 images. The one you're viewing is already selected.
              </p>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                {images.map((img) => {
                  const checked = selectedIds.includes(img.id);
                  const locked = img.id === initialAsset.id;
                  const dimmed = !checked && limitReached;
                  return (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => {
                        if (dimmed) {
                          toast(`You can select at most ${MAX} images.`);
                          return;
                        }
                        toggle(img.id);
                      }}
                      className={
                        "relative aspect-square overflow-hidden rounded-xl border transition " +
                        (checked
                          ? "border-transparent ring-2 ring-offset-2 ring-offset-background"
                          : "border-foreground/10 hover:border-foreground/30") +
                        (dimmed ? " opacity-40" : "")
                      }
                      style={
                        checked
                          ? { boxShadow: "0 0 0 2px var(--aurora-2)" }
                          : undefined
                      }
                    >
                      <img src={proxyMediaUrl(img.url)} alt={img.title} className="h-full w-full object-cover" />
                      <span
                        className={
                          "absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border " +
                          (checked
                            ? "border-transparent text-white"
                            : "border-white/80 bg-black/30")
                        }
                        style={
                          checked
                            ? { background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }
                            : undefined
                        }
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      {locked && (
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                          Source
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <DialogFooter className="items-center justify-between sm:justify-between">
                <span className="text-xs text-muted-foreground">
                  Selected: {selectedIds.length} / {MAX}
                </span>
                <Button onClick={() => setStep(2)} disabled={!canNext}>Next</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Remix Images</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedAssets.map((a) => (
                    <img
                      key={a.id}
                      src={proxyMediaUrl(a.url)}
                      alt={a.title}
                      className="h-16 w-16 shrink-0 rounded-lg border border-foreground/10 object-cover"
                    />
                  ))}
                </div>

                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="How should these be combined?"
                  rows={3}
                  className="max-h-48 min-h-[80px] resize-y"
                />

                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setPickerOpen(true)}
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
                  <Label>Aspect ratio</Label>
                  <AspectRatioSelect value={imageSize} onChange={setImageSize} includeAuto />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Quality</Label>
                  <QualitySelect value={quality} onChange={setQuality} />
                </div>
              </div>
              <DialogFooter className="justify-between sm:justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={handleRemix} disabled={submitting || (!prompt.trim() && docIds.length === 0)}>
                  {submitting ? "Starting…" : "Remix"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <DocumentPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialSelectedIds={docIds}
        onConfirm={setDocIds}
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
