import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { proxyMediaUrl } from "@/lib/sb-proxy";
import { baseTitle } from "@/lib/redo-title";

const BUCKET = "joystick-media";

interface SourceAsset {
  id: string;
  url: string | null;
  title: string;
  width?: number | null;
  height?: number | null;
  mime_type?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceAsset: SourceAsset;
  onSubmitted?: () => void;
}

/** Downscale in halving passes so big reductions stay smooth. */
async function shrinkToBlob(
  src: string,
  targetW: number,
  targetH: number,
  mime: string,
  quality: number,
): Promise<Blob> {
  const res = await fetch(src);
  if (!res.ok) throw new Error("Could not load the image");
  const bitmap = await createImageBitmap(await res.blob());

  let curW = bitmap.width;
  let curH = bitmap.height;
  let canvas = document.createElement("canvas");
  canvas.width = curW;
  canvas.height = curH;
  let ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.drawImage(bitmap, 0, 0);

  while (curW / 2 > targetW && curH / 2 > targetH) {
    const nextW = Math.max(targetW, Math.floor(curW / 2));
    const nextH = Math.max(targetH, Math.floor(curH / 2));
    const next = document.createElement("canvas");
    next.width = nextW;
    next.height = nextH;
    const nctx = next.getContext("2d");
    if (!nctx) throw new Error("Canvas is unavailable");
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(canvas, 0, 0, nextW, nextH);
    canvas = next;
    ctx = nctx;
    curW = nextW;
    curH = nextH;
  }

  if (curW !== targetW || curH !== targetH) {
    const final = document.createElement("canvas");
    final.width = targetW;
    final.height = targetH;
    const fctx = final.getContext("2d");
    if (!fctx) throw new Error("Canvas is unavailable");
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(canvas, 0, 0, targetW, targetH);
    canvas = final;
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), mime, quality),
  );
  if (!blob) throw new Error("Could not shrink the image");
  return blob;
}

export function ShrinkImageDialog({ open, onOpenChange, sourceAsset, onSubmitted }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState("50");
  const [customLongest, setCustomLongest] = useState("1024");
  const [format, setFormat] = useState("keep");
  const [quality, setQuality] = useState(85);
  const [working, setWorking] = useState(false);

  const w = sourceAsset.width ?? null;
  const h = sourceAsset.height ?? null;

  const target = useMemo(() => {
    if (!w || !h) return null;
    if (mode === "custom") {
      const longest = Math.max(16, Math.min(20000, Number(customLongest) || 0));
      const scale = longest / Math.max(w, h);
      if (!Number.isFinite(scale) || scale <= 0) return null;
      return {
        width: Math.max(1, Math.round(w * Math.min(scale, 1))),
        height: Math.max(1, Math.round(h * Math.min(scale, 1))),
      };
    }
    const pct = Number(mode) / 100;
    return { width: Math.max(1, Math.round(w * pct)), height: Math.max(1, Math.round(h * pct)) };
  }, [w, h, mode, customLongest]);

  const reset = () => {
    setMode("50");
    setCustomLongest("1024");
    setFormat("keep");
    setQuality(85);
  };

  const handleShrink = async () => {
    if (!sourceAsset.url) {
      toast.error("This image has no URL yet");
      return;
    }
    if (!target) {
      toast.error("This image has no size information yet");
      return;
    }
    setWorking(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      const srcMime = sourceAsset.mime_type ?? "image/png";
      const outMime = format === "jpeg" ? "image/jpeg" : srcMime === "image/jpeg" ? "image/jpeg" : "image/png";
      const ext = outMime === "image/jpeg" ? "jpg" : "png";

      const blob = await shrinkToBlob(
        proxyMediaUrl(sourceAsset.url),
        target.width,
        target.height,
        outMime,
        outMime === "image/jpeg" ? quality / 100 : 1,
      );

      const path = `${u.user.id}/${Date.now()}_shrunk.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: outMime, upsert: false });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const { error: insErr } = await supabase.from("media_assets").insert({
        user_id: u.user.id,
        title: `${baseTitle(sourceAsset.title)} (small)`,
        kind: "image",
        status: "completed",
        url: pub.publicUrl,
        storage_path: path,
        mime_type: outMime,
        size_bytes: blob.size,
        width: target.width,
        height: target.height,
        generation_params: {
          mode: "shrink",
          source_asset_id: sourceAsset.id,
          target_width: target.width,
          target_height: target.height,
        },
      } as never);
      if (insErr) throw insErr;

      qc.invalidateQueries({ queryKey: ["media_assets"] });
      onOpenChange(false);
      reset();
      onSubmitted?.();
      toast.success(`Shrunk to ${target.width} x ${target.height}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not shrink the image");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shrink Image</DialogTitle>
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
              {w && h ? `Currently ${w} x ${h}` : "Size unknown"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Size</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="75">75%</SelectItem>
                <SelectItem value="50">50%</SelectItem>
                <SelectItem value="25">25%</SelectItem>
                <SelectItem value="custom">Custom longest side</SelectItem>
              </SelectContent>
            </Select>
            {mode === "custom" && (
              <Input
                type="number"
                inputMode="numeric"
                min={16}
                value={customLongest}
                onChange={(e) => setCustomLongest(e.target.value)}
                placeholder="Longest side in pixels"
              />
            )}
            {target && (
              <p className="text-xs text-muted-foreground">
                Result: {target.width} x {target.height}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep original</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(format === "jpeg" || (sourceAsset.mime_type ?? "") === "image/jpeg") && (
            <div className="flex flex-col gap-1.5">
              <Label>JPEG quality: {quality}</Label>
              <Slider
                min={40}
                max={100}
                step={5}
                value={[quality]}
                onValueChange={(v) => setQuality(v[0] ?? 85)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          <Button onClick={handleShrink} disabled={working || !target}>
            {working ? "Shrinking…" : "Shrink"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
