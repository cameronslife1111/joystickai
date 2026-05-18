import { useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
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
import { assembleImagePrompt } from "@/lib/media-prompt";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateImageDialog({ open, onOpenChange }: Props) {
  const [prompt, setPrompt] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [imageSize, setImageSize] = useState("portrait_16_9");
  const [quality, setQuality] = useState("high");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPrompt("");
    setDocIds([]);
    setImageSize("portrait_16_9");
    setQuality("high");
  };

  const canSubmit = !submitting && (prompt.trim().length > 0 || docIds.length > 0);

  const handleGenerate = async () => {
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
          title: prompt.trim().slice(0, 60) || "Generated image",
          kind: "image",
          status: "generating",
          generation_params: {
            mode: "text-to-image",
            user_text: prompt,
            document_ids: docIds,
            image_size: imageSize,
            quality,
          },
        } as any)
        .select()
        .single();
      if (error || !row) throw error ?? new Error("Failed to create row");

      const { error: fnErr } = await supabase.functions.invoke("generate-image", {
        body: {
          row_id: row.id,
          prompt: finalPrompt,
          image_size: imageSize,
          quality,
          output_format: "png",
        },
      });
      if (fnErr) throw fnErr;

      onOpenChange(false);
      reset();
      toast("Generating your image...", {
        description: "It'll appear in the gallery when ready.",
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
            <DialogTitle>Generate Image</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want to create..."
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
              <AspectRatioSelect value={imageSize} onChange={setImageSize} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Quality</Label>
              <QualitySelect value={quality} onChange={setQuality} />
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
