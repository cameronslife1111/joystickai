import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Music, Pencil, Expand } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { proxyMediaUrl } from "@/lib/sb-proxy";

export type MediaAsset = {
  id: string;
  user_id: string;
  title: string;
  kind: "image" | "video" | "audio";
  url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  created_at: string;
  status?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "image" | "video" | "audio";
  mode: "single" | "multiple";
  maxSelected?: number;
  initialSelectedIds?: string[];
  onConfirm: (assets: MediaAsset[]) => void;
  /** Custom sheet heading (defaults to "Choose {kind}"). */
  heading?: string;
  /** Show each asset's title on its tile. */
  showTitles?: boolean;
  /** Show per-tile rename + full-screen view buttons. */
  allowManage?: boolean;
}

export function MediaGalleryPicker({
  open,
  onOpenChange,
  kind,
  mode,
  maxSelected = 16,
  initialSelectedIds = [],
  onConfirm,
  heading,
  showTitles = false,
  allowManage = false,
}: Props) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [renameAsset, setRenameAsset] = useState<MediaAsset | null>(null);
  const [renameText, setRenameText] = useState("");
  const [viewAsset, setViewAsset] = useState<MediaAsset | null>(null);

  useEffect(() => {
    if (open) setSelectedIds(initialSelectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["media_assets_picker", kind],
    enabled: open,
    queryFn: async (): Promise<MediaAsset[]> => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("kind", kind)
        .or("status.is.null,status.eq.completed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MediaAsset[];
    },
  });

  const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
  const capHit = mode === "multiple" && selectedIds.length >= maxSelected;

  const selectedAssets = useMemo(
    () => selectedIds
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is MediaAsset => !!a),
    [selectedIds, assets],
  );

  const toggle = (id: string) => {
    setSelectedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (mode === "single") return [id];
      if (cur.length >= maxSelected) return cur;
      return [...cur, id];
    });
  };

  const handleRename = async () => {
    if (!renameAsset) return;
    const title = renameText.trim() || "Untitled";
    const { error } = await supabase
      .from("media_assets")
      .update({ title })
      .eq("id", renameAsset.id);
    if (error) {
      toast.error(error.message ?? "Could not rename");
      return;
    }
    setRenameAsset(null);
    toast.success("Renamed");
    await qc.invalidateQueries({ queryKey: ["media_assets_picker"] });
    await qc.invalidateQueries({ queryKey: ["media_assets"] });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[85vh] flex-col">
        <SheetHeader>
          <SheetTitle>{heading ?? `Choose ${kind}`}</SheetTitle>
          <p className="text-xs text-muted-foreground">From your Media Gallery</p>
        </SheetHeader>
        <div className="-mx-6 flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : assets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No {kind}s in your gallery yet. Upload some first.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {assets.map((a) => {
                const selIdx = selectedIds.indexOf(a.id);
                const isSelected = selIdx >= 0;
                const dimmed = !isSelected && capHit;
                return (
                  <div key={a.id} className="relative">
                    <button
                      type="button"
                      disabled={dimmed}
                      onClick={() => toggle(a.id)}
                      className={
                        "group relative aspect-square w-full overflow-hidden rounded-2xl border bg-foreground/5 transition active:scale-95 " +
                        (isSelected ? "border-transparent" : "border-foreground/10 ") +
                        (dimmed ? "opacity-50 pointer-events-none" : "")
                      }
                      style={
                        isSelected
                          ? {
                              boxShadow:
                                "0 0 0 2px var(--background), 0 0 0 4px var(--aurora-1)",
                              backgroundImage:
                                "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))",
                            }
                          : undefined
                      }
                    >
                      {a.kind === "image" && a.url && (
                        <img
                          src={proxyMediaUrl(a.url)}
                          alt={a.title}
                          loading="lazy"
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      )}
                      {a.kind === "video" && a.url && (
                        <>
                          <video
                            src={proxyMediaUrl(a.url)}
                            preload="metadata"
                            muted
                            playsInline
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="h-8 w-8 text-white drop-shadow" />
                          </div>
                        </>
                      )}
                      {a.kind === "audio" && (
                        <div
                          className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
                          style={{
                            background:
                              "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))",
                          }}
                        >
                          <Music className="h-7 w-7 text-white" />
                          <span className="line-clamp-2 text-[10px] text-white/90">
                            {a.title}
                          </span>
                        </div>
                      )}
                      {showTitles && a.kind !== "audio" && (
                        <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-black/55 px-1.5 py-1 text-left text-[10px] leading-tight text-white">
                          {a.title}
                        </span>
                      )}
                      {isSelected && (
                        <span
                          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow"
                          style={{
                            background:
                              "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))",
                          }}
                        >
                          {mode === "multiple" ? selIdx + 1 : "✓"}
                        </span>
                      )}
                    </button>
                    {allowManage && (
                      <>
                        <button
                          type="button"
                          aria-label={`Rename ${a.title}`}
                          onClick={() => {
                            setRenameAsset(a);
                            setRenameText(a.title);
                          }}
                          className="absolute left-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white shadow transition active:scale-90"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        {a.url && (
                          <button
                            type="button"
                            aria-label={`View ${a.title}`}
                            onClick={() => setViewAsset(a)}
                            className="absolute bottom-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white shadow transition active:scale-90"
                          >
                            <Expand className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div
          className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-foreground/10 bg-background pt-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <p className="text-xs text-muted-foreground">
            Selected: {selectedIds.length}
            {mode === "multiple" ? ` / ${maxSelected}` : ""}
          </p>
          <Button
            disabled={selectedIds.length === 0}
            onClick={() => {
              onConfirm(selectedAssets);
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>

        {/* Rename dialog */}
        {renameAsset && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setRenameAsset(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-card p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-3 font-display text-base">Rename</p>
              <input
                autoFocus
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRename();
                  if (e.key === "Escape") setRenameAsset(null);
                }}
                className="mb-4 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRenameAsset(null)}
                  className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleRename()}
                  className="rounded-xl border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-primary hover:bg-primary/25"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Full-screen view */}
        {viewAsset && (
          <div
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 p-4"
            onClick={() => setViewAsset(null)}
          >
            {viewAsset.kind === "image" && viewAsset.url && (
              <img
                src={proxyMediaUrl(viewAsset.url)}
                alt={viewAsset.title}
                className="max-h-[75vh] max-w-full rounded-2xl object-contain"
              />
            )}
            {viewAsset.kind === "video" && viewAsset.url && (
              <video
                src={proxyMediaUrl(viewAsset.url)}
                controls
                autoPlay
                playsInline
                className="max-h-[75vh] max-w-full rounded-2xl"
              />
            )}
            {viewAsset.kind === "audio" && viewAsset.url && (
              <audio src={proxyMediaUrl(viewAsset.url)} controls autoPlay className="w-full max-w-sm" />
            )}
            <p className="mt-3 max-w-full break-words text-center text-sm text-white">
              {viewAsset.title}
            </p>
            <p className="mt-1 text-xs text-white/60">Tap anywhere to close</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
