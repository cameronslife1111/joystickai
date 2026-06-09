import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Music } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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
}

export function MediaGalleryPicker({
  open,
  onOpenChange,
  kind,
  mode,
  maxSelected = 16,
  initialSelectedIds = [],
  onConfirm,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[85vh] flex-col">
        <SheetHeader>
          <SheetTitle>Choose {kind}</SheetTitle>
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
                  <button
                    type="button"
                    key={a.id}
                    disabled={dimmed}
                    onClick={() => toggle(a.id)}
                    className={
                      "group relative aspect-square overflow-hidden rounded-2xl border bg-foreground/5 transition active:scale-95 " +
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
                        src={toProxiedMediaUrl(a.url) ?? undefined}
                        alt={a.title}
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    )}
                    {a.kind === "video" && a.url && (
                      <>
                        <video
                          src={toProxiedMediaUrl(a.url) ?? undefined}
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
      </SheetContent>
    </Sheet>
  );
}
