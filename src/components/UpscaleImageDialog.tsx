import { useState } from "react";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { proxyMediaUrl } from "@/lib/sb-proxy";
import { nextRedoTitle } from "@/lib/redo-title";
import { startImageUpscale } from "@/lib/upscale.functions";

interface SourceAsset {
  id: string;
  url: string | null;
  title: string;
  width?: number | null;
  height?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceAsset: SourceAsset;
  onSubmitted?: () => void;
}

export function UpscaleImageDialog({ open, onOpenChange, sourceAsset, onSubmitted }: Props) {
  const qc = useQueryClient();
  const startUpscale = useServerFn(startImageUpscale);
  const [factor, setFactor] = useState(2);
  const [strength, setStrength] = useState("auto");
  const [faceEnhance, setFaceEnhance] = useState(true);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [submitting, setSubmitting] = useState(false);

  const w = sourceAsset.width ?? null;
  const h = sourceAsset.height ?? null;
  const outSize = w && h ? `about ${Math.round(w * factor)} x ${Math.round(h * factor)}` : null;

  const reset = () => {
    setFactor(2);
    setStrength("auto");
    setFaceEnhance(true);
    setFormat("jpeg");
  };

  const handleStart = async () => {
    if (!sourceAsset.url) {
      toast.error("This image has no URL yet");
      return;
    }
    setSubmitting(true);
    try {
      const title = await nextRedoTitle(sourceAsset.title);
      await startUpscale({
        data: {
          sourceAssetId: sourceAsset.id,
          imageUrl: sourceAsset.url,
          title,
          upscaleFactor: factor,
          outputFormat: format,
          faceEnhancement: faceEnhance,
          enhancementStrength: strength === "auto" ? null : (strength as "low" | "medium" | "high"),
        },
      });

      qc.invalidateQueries({ queryKey: ["media_assets"] });
      onOpenChange(false);
      reset();
      onSubmitted?.();
      toast("Upscaling your image...", {
        description: "It'll appear in the gallery when ready.",
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start upscale");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upscale Image</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {sourceAsset.url && (
              <img
                src={proxyMediaUrl(sourceAsset.url)}
                alt="Source"
                className="h-24 w-24 rounded-xl border border-foreground/10 object-cover"
              />
            )}
            <span className="text-sm text-muted-foreground">
              {w && h ? `Currently ${w} x ${h}` : "Upscaling this image"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Upscale factor: {factor.toFixed(1)}x</Label>
            <Slider
              min={1.5}
              max={4}
              step={0.5}
              value={[factor]}
              onValueChange={(v) => setFactor(v[0] ?? 2)}
            />
            {outSize && <p className="text-xs text-muted-foreground">Result: {outSize}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Enhancement strength</Label>
            <Select value={strength} onValueChange={setStrength}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="face-enhance">Face enhancement</Label>
            <Switch id="face-enhance" checked={faceEnhance} onCheckedChange={setFaceEnhance} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Output format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as "jpeg" | "png")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          <Button onClick={handleStart} disabled={submitting}>
            {submitting ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
