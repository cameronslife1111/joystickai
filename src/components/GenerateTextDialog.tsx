import { useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
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
import { DocumentPickerSheet } from "./DocumentPickerSheet";
import { DestinationPicker, type DestinationPosition } from "./DestinationPicker";
import { supabase } from "@/integrations/supabase/client";
import { generateText as generateTextFn } from "@/lib/ai.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocumentId: string;
  documents: { id: string; title: string }[];
}

export function GenerateTextDialog({ open, onOpenChange, currentDocumentId, documents }: Props) {
  const qc = useQueryClient();
  const generate = useServerFn(generateTextFn);

  const [promptText, setPromptText] = useState("");
  const [contextDocIds, setContextDocIds] = useState<string[]>([]);
  const [targetDocumentId, setTargetDocumentId] = useState(currentDocumentId);
  const [position, setPosition] = useState<DestinationPosition>("after_current");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTargetDocumentId(currentDocumentId);
      setPosition("after_current");
    }
  }, [open, currentDocumentId]);

  const reset = () => {
    setPromptText("");
    setContextDocIds([]);
    setTargetDocumentId(currentDocumentId);
    setPosition("after_current");
  };

  const canSubmit =
    !busy &&
    !!targetDocumentId &&
    (promptText.trim().length > 0 || contextDocIds.length > 0);

  const handleGenerate = async () => {
    try {
      setBusy(true);
      const result = await generate({
        data: {
          prompt: promptText,
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
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Text</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="What would you like to write about?"
              rows={3}
              className="max-h-64 min-h-[80px] resize-y"
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
            <Button onClick={handleGenerate} disabled={!canSubmit}>
              {busy ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DocumentPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
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
