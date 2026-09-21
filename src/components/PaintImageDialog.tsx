import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { proxyMediaUrl } from "@/lib/sb-proxy";
import { baseTitle } from "@/lib/redo-title";
import { Brush, Eraser, Loader2, Trash2, Type, Undo2, X } from "lucide-react";

const BUCKET = "joystick-media";

const COLORS = [
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

/** Snapshots are capped so a long session can't exhaust memory on phones. */
const MAX_HISTORY = 16;

export interface PaintSourceAsset {
  id: string;
  url: string | null;
  title: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
}

type Tool = "brush" | "eraser" | "text";

interface TextItem {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

interface Snapshot {
  paint: ImageData | null;
  texts: TextItem[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: PaintSourceAsset;
  /** Called after a successful save (copy or replace). */
  onSaved?: () => void;
}

/**
 * Draw-on-any-image editor.
 *
 * Three layers at the image's natural pixel size: the photo (base), a paint
 * canvas (strokes / eraser), and text objects that stay movable until save.
 * The visible canvas is a composite of all three, scaled with CSS to fit.
 */
export function PaintImageDialog({ open, onOpenChange, asset, onSaved }: Props) {
  const qc = useQueryClient();

  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#ef4444");
  const [brushSize, setBrushSize] = useState(24);
  const [textSize, setTextSize] = useState(64);
  const [textValue, setTextValue] = useState("");
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askSave, setAskSave] = useState(false);

  const [w, h] = size;

  /* --------------------------------- render -------------------------------- */

  const textsRef = useRef<TextItem[]>([]);
  textsRef.current = texts;
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedTextId;

  const drawTexts = useCallback((ctx: CanvasRenderingContext2D, items: TextItem[], marks: boolean) => {
    for (const t of items) {
      ctx.save();
      ctx.font = `bold ${t.size}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, t.size / 12);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      if (marks && t.id === selectedRef.current) {
        const m = ctx.measureText(t.text);
        ctx.setLineDash([Math.max(6, t.size / 6), Math.max(6, t.size / 6)]);
        ctx.lineWidth = Math.max(2, t.size / 20);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.strokeRect(t.x - 6, t.y - 6, m.width + 12, t.size * 1.25 + 12);
      }
      ctx.restore();
    }
  }, []);

  const render = useCallback(() => {
    const view = viewRef.current;
    const base = baseRef.current;
    const paint = paintRef.current;
    if (!view || !base || !paint) return;
    const ctx = view.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(paint, 0, 0);
    drawTexts(ctx, textsRef.current, true);
  }, [drawTexts]);

  useEffect(() => {
    if (!loading) render();
  }, [texts, selectedTextId, loading, render]);

  /* ---------------------------------- load --------------------------------- */

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setTexts([]);
    setSelectedTextId(null);
    setTextValue("");
    setTool("brush");
    setAskSave(false);
    historyRef.current = [];
    setCanUndo(false);

    (async () => {
      try {
        if (!asset.url) throw new Error("This image has no file yet");
        const res = await fetch(proxyMediaUrl(asset.url));
        if (!res.ok) throw new Error("Could not load the image");
        const bitmap = await createImageBitmap(await res.blob());
        if (cancelled) return;

        const base = document.createElement("canvas");
        base.width = bitmap.width;
        base.height = bitmap.height;
        base.getContext("2d")?.drawImage(bitmap, 0, 0);
        baseRef.current = base;

        const paint = document.createElement("canvas");
        paint.width = bitmap.width;
        paint.height = bitmap.height;
        paintRef.current = paint;

        setSize([bitmap.width, bitmap.height]);
        setLoading(false);
        requestAnimationFrame(render);
      } catch (e: any) {
        if (!cancelled) {
          toast.error(e?.message ?? "Could not open this image");
          onOpenChange(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset.id, asset.url]);

  /* -------------------------------- history -------------------------------- */

  const pushHistory = useCallback(() => {
    const paint = paintRef.current;
    let data: ImageData | null = null;
    if (paint) {
      const ctx = paint.getContext("2d");
      if (ctx) data = ctx.getImageData(0, 0, paint.width, paint.height);
    }
    historyRef.current.push({ paint: data, texts: textsRef.current.map((t) => ({ ...t })) });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    const paint = paintRef.current;
    const ctx = paint?.getContext("2d");
    if (paint && ctx) {
      ctx.clearRect(0, 0, paint.width, paint.height);
      if (prev.paint) ctx.putImageData(prev.paint, 0, 0);
    }
    setTexts(prev.texts);
    setSelectedTextId(null);
    setCanUndo(historyRef.current.length > 0);
    requestAnimationFrame(render);
  }, [render]);

  const clearAll = useCallback(() => {
    pushHistory();
    const paint = paintRef.current;
    const ctx = paint?.getContext("2d");
    if (paint && ctx) ctx.clearRect(0, 0, paint.width, paint.height);
    setTexts([]);
    setSelectedTextId(null);
    requestAnimationFrame(render);
  }, [pushHistory, render]);

  /* ------------------------------- pointers -------------------------------- */

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return { x: 0, y: 0 };
    const rect = view.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * view.width,
      y: ((e.clientY - rect.top) / rect.height) * view.height,
    };
  };

  const hitText = (x: number, y: number): TextItem | null => {
    const view = viewRef.current;
    const ctx = view?.getContext("2d");
    if (!ctx) return null;
    for (let i = textsRef.current.length - 1; i >= 0; i--) {
      const t = textsRef.current[i];
      ctx.save();
      ctx.font = `bold ${t.size}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const m = ctx.measureText(t.text);
      ctx.restore();
      if (x >= t.x - 8 && x <= t.x + m.width + 8 && y >= t.y - 8 && y <= t.y + t.size * 1.25 + 8) return t;
    }
    return null;
  };

  const strokeTo = (x: number, y: number) => {
    const paint = paintRef.current;
    const ctx = paint?.getContext("2d");
    if (!paint || !ctx) return;
    const from = lastRef.current ?? { x, y };
    ctx.save();
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
    lastRef.current = { x, y };
    render();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (loading || saving) return;
    e.preventDefault();
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { x, y } = toImage(e);

    const hit = hitText(x, y);
    if (hit) {
      pushHistory();
      setSelectedTextId(hit.id);
      setTextValue(hit.text);
      setTextSize(hit.size);
      dragRef.current = { id: hit.id, dx: x - hit.x, dy: y - hit.y };
      return;
    }

    if (tool === "text") {
      const value = textValue.trim();
      if (!value) {
        toast.error("Type your words in the box first");
        return;
      }
      pushHistory();
      const item: TextItem = { id: crypto.randomUUID(), text: value, x, y: y - textSize / 2, size: textSize, color };
      setTexts((prev) => [...prev, item]);
      setSelectedTextId(item.id);
      return;
    }

    pushHistory();
    setSelectedTextId(null);
    drawingRef.current = true;
    lastRef.current = { x, y };
    strokeTo(x, y);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const { x, y } = toImage(e);
    if (dragRef.current) {
      const d = dragRef.current;
      setTexts((prev) => prev.map((t) => (t.id === d.id ? { ...t, x: x - d.dx, y: y - d.dy } : t)));
      return;
    }
    if (!drawingRef.current) return;
    strokeTo(x, y);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    drawingRef.current = false;
    lastRef.current = null;
    dragRef.current = null;
  };

  /* --------------------------------- saving -------------------------------- */

  const selected = useMemo(() => texts.find((t) => t.id === selectedTextId) ?? null, [texts, selectedTextId]);

  const updateSelected = (patch: Partial<TextItem>) => {
    if (!selectedTextId) return;
    setTexts((prev) => prev.map((t) => (t.id === selectedTextId ? { ...t, ...patch } : t)));
  };

  const flatten = async (): Promise<{ blob: Blob; mime: string; ext: string }> => {
    const base = baseRef.current;
    const paint = paintRef.current;
    if (!base || !paint) throw new Error("Nothing to save yet");
    const out = document.createElement("canvas");
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(paint, 0, 0);
    drawTexts(ctx, textsRef.current, false);

    const isJpeg = (asset.mime_type ?? "") === "image/jpeg";
    const mime = isJpeg ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, mime, isJpeg ? 0.92 : undefined),
    );
    if (!blob) throw new Error("Could not build the image");
    return { blob, mime, ext: isJpeg ? "jpg" : "png" };
  };

  const save = async (mode: "copy" | "replace") => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { blob, mime, ext } = await flatten();

      const path = `${u.user.id}/${Date.now()}_painted.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

      if (mode === "copy") {
        const { error: insErr } = await supabase.from("media_assets").insert({
          user_id: u.user.id,
          title: `${baseTitle(asset.title ?? "Untitled")} (painted)`,
          kind: "image",
          status: "completed",
          url: pub.publicUrl,
          storage_path: path,
          mime_type: mime,
          size_bytes: blob.size,
          width: w,
          height: h,
          generation_params: { mode: "paint", source_asset_id: asset.id },
        } as never);
        if (insErr) throw insErr;
      } else {
        const oldPath = asset.storage_path ?? null;
        const { error: updErr } = await supabase
          .from("media_assets")
          .update({
            url: pub.publicUrl,
            storage_path: path,
            mime_type: mime,
            size_bytes: blob.size,
            width: w,
            height: h,
          } as never)
          .eq("id", asset.id)
          .eq("user_id", u.user.id);
        if (updErr) throw updErr;
        if (oldPath && oldPath !== path) {
          await supabase.storage.from(BUCKET).remove([oldPath]);
        }
      }

      qc.invalidateQueries({ queryKey: ["media_assets"] });
      qc.invalidateQueries({ queryKey: ["chat_media"] });
      toast.success(mode === "copy" ? "Saved as a new picture" : "Picture updated");
      setAskSave(false);
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the picture");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-xl border transition active:scale-95 ${
        tool === t ? "border-primary bg-primary/20 text-primary" : "border-white/15 bg-white/5 text-white"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95">
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-2 px-3 pb-2"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Cancel"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="truncate text-sm text-white/80">{asset.title ?? "Untitled"}</span>
        <Button size="sm" disabled={loading || saving} onClick={() => setAskSave(true)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        ) : (
          <canvas
            ref={viewRef}
            width={w}
            height={h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="max-h-full max-w-full object-contain"
            style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
          />
        )}
      </div>

      {/* Tools */}
      <div
        className="flex flex-col gap-2 border-t border-white/10 bg-black/80 px-3 pt-2"
        style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-2 overflow-x-auto">
          {toolBtn("brush", <Brush className="h-5 w-5" />, "Brush")}
          {toolBtn("eraser", <Eraser className="h-5 w-5" />, "Eraser")}
          {toolBtn("text", <Type className="h-5 w-5" />, "Text")}
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white disabled:opacity-40"
          >
            <Undo2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={clearAll}
            aria-label="Clear all"
            title="Clear all"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>

        {tool === "text" && (
          <Input
            value={textValue}
            onChange={(e) => {
              setTextValue(e.target.value);
              if (selectedTextId) updateSelected({ text: e.target.value });
            }}
            placeholder="Type words, then tap the picture"
            className="h-10 border-white/15 bg-white/5 text-white placeholder:text-white/40"
          />
        )}

        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-xs text-white/70">{tool === "text" ? "Size" : "Brush"}</span>
          <Slider
            value={[tool === "text" ? (selected?.size ?? textSize) : brushSize]}
            min={tool === "text" ? 12 : 2}
            max={tool === "text" ? Math.max(200, Math.round((h || 800) / 3)) : 160}
            step={1}
            onValueChange={(v) => {
              const n = v[0];
              if (tool === "text") {
                setTextSize(n);
                if (selectedTextId) updateSelected({ size: n });
              } else {
                setBrushSize(n);
              }
            }}
            className="flex-1"
          />
          <span
            className="shrink-0 rounded-full border border-white/30"
            style={{
              width: Math.min(28, Math.max(6, brushSize / 4)),
              height: Math.min(28, Math.max(6, brushSize / 4)),
              background: tool === "eraser" ? "transparent" : color,
            }}
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => {
                setColor(c);
                if (selectedTextId) updateSelected({ color: c });
                if (tool === "eraser") setTool("brush");
              }}
              className={`h-8 w-8 shrink-0 rounded-full border-2 ${
                color === c ? "border-primary" : "border-white/25"
              }`}
              style={{ background: c }}
            />
          ))}
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-white/25 px-2 text-xs text-white">
            More
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                if (selectedTextId) updateSelected({ color: e.target.value });
                if (tool === "eraser") setTool("brush");
              }}
              className="h-5 w-6 bg-transparent"
            />
          </label>
        </div>
      </div>

      {/* Save choice */}
      {askSave && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/70 p-4">
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-card p-4"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <p className="mb-3 text-center font-display text-base">Save your drawing</p>
            <div className="flex flex-col gap-2">
              <Button disabled={saving} onClick={() => save("copy")}>
                Save as copy
              </Button>
              <Button variant="secondary" disabled={saving} onClick={() => save("replace")}>
                Replace original
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => setAskSave(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
