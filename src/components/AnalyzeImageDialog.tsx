import { useEffect, useState } from "react";
import { Paperclip, Library, X } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
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
import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { DestinationPicker, type DestinationPosition } from "./DestinationPicker";
import { MediaGalleryPicker, type MediaAsset } from "./MediaGalleryPicker";
import { supabase } from "@/integrations/supabase/client";
import { analyzeImage as analyzeImageFn } from "@/lib/ai.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocumentId: string;
  documents: { id: string; title: string }[];
}

export function AnalyzeImageDialog({ open, onOpenChange, currentDocumentId, documents }: Props) {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeImageFn);

  const [pickedImage, setPickedImage] = useState<MediaAsset | null>(null);
  const [promptText, setPromptText] = useState("");
  const [contextDocIds, setContextDocIds] = useState<string[]>([]);
  const [targetDocumentId, setTargetDocumentId] = useState(currentDocumentId);
  const [position, setPosition] = useState<DestinationPosition>("after_current");
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTargetDocumentId(currentDocumentId);
      setPosition("after_current");
    }
  }, [open, currentDocumentId]);

  const reset = () => {
    setPickedImage(null);
    setPromptText("");
    setContextDocIds([]);
    setTargetDocumentId(currentDocumentId);
    setPosition("after_current");
  };

  const canSubmit = !busy && !!pickedImage && !!pickedImage.url && !!targetDocumentId;

  const handleAnalyze = async () => {
    if (!pickedImage?.url) return;
    try {
      setBusy(true);
      const result = await analyze({
        data: {
          prompt: promptText,
          imageUrl: pickedImage.url,
          contextDocumentIds: contextDocIds,
          targetDocumentId,
          position,
        },
      });
      toast.success(
        `Added ${result.insertedCount} sentence${result.insertedCount === 1 ? "" : "s"}`,
      );
      qc.invalidateQueries({ queryKey: ["sentences", result.targetDocumentId] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image analysis failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Analyze Image</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Image to analyze</Label>
              {pickedImage ? (
                <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-2">
                  {pickedImage.url && (
                    <img
                      src={pickedImage.url}
                      alt={pickedImage.title}
                      className="h-16 w-16 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <p className="min-w-0 flex-1 truncate text-sm">{pickedImage.title || "Untitled"}</p>
                  <Button size="sm" variant="ghost" onClick={() => setImagePickerOpen(true)}>
                    Change
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPickedImage(null)}
                    aria-label="Clear image"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={() => setImagePickerOpen(true)}
                >
                  <Library className="mr-2 h-4 w-4" /> Choose image from gallery
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>What should the AI focus on?</Label>
              <Textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Optional — e.g. 'What's the mood?' or leave blank for a general description."
                rows={2}
                className="max-h-48 min-h-[60px] resize-y"
              />
            </div>

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
              {contextDocIds.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {contextDocIds.map((id) => (
                    <DocChip
                      key={id}
                      id={id}
                      onRemove={() => setContextDocIds((cur) => cur.filter((x) => x !== id))}
                    />
                  ))}
                </div>
              )}
            </div>

            <DestinationPicker
              documents={documents}
              targetDocumentId={targetDocumentId}
              onTargetDocumentIdChange={setTargetDocumentId}
              position={position}
              onPositionChange={setPosition}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>
              Cancel
            </Button>
            <Button onClick={handleAnalyze} disabled={!canSubmit}>
              {busy ? "Analyzing…" : "Analyze"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaGalleryPicker
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        kind="image"
        mode="single"
        initialSelectedIds={pickedImage ? [pickedImage.id] : []}
        onConfirm={(assets) => {
          if (assets[0]) setPickedImage(assets[0]);
        }}
      />

      <DocumentPickerSheet
        open={docPickerOpen}
        onOpenChange={setDocPickerOpen}
        initialSelectedIds={contextDocIds}
        onConfirm={setContextDocIds}
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
