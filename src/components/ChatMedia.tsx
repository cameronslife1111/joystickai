import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { proxyMediaUrl } from "@/lib/sb-proxy";
import { Film, Music, ImageIcon } from "lucide-react";

export type ChatAsset = {
  id: string;
  title: string | null;
  kind: string;
  url: string | null;
  mime_type: string | null;
};

/** Quoted media titles the user dropped into a message: "Sunset over the bay". */
export function quotedTitles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"\n]{2,120})"/g)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

/**
 * Resolves media the chat should show inline: assets a plan produced (by id)
 * and assets the user referenced by quoted title.
 */
export function useChatMedia(ids: string[], titles: string[]) {
  const idKey = ids.slice().sort().join(",");
  const titleKey = titles.slice().sort().join("|");

  return useQuery({
    queryKey: ["chat_media", idKey, titleKey],
    enabled: ids.length > 0 || titles.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<ChatAsset[]> => {
      const found = new Map<string, ChatAsset>();
      const cols = "id, title, kind, url, mime_type";

      if (ids.length) {
        const { data } = await supabase.from("media_assets").select(cols).in("id", ids);
        for (const a of (data ?? []) as ChatAsset[]) found.set(a.id, a);
      }
      if (titles.length) {
        const { data } = await supabase.from("media_assets").select(cols).in("title", titles);
        for (const a of (data ?? []) as ChatAsset[]) found.set(a.id, a);
      }
      return Array.from(found.values());
    },
  });
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "video") return <Film className="h-5 w-5" />;
  if (kind === "audio") return <Music className="h-5 w-5" />;
  return <ImageIcon className="h-5 w-5" />;
}

/**
 * A row of media thumbnails inside the chat. Tapping one opens it full size
 * (image), or plays it (video/audio) — all through the cellular-safe proxy.
 */
export function ChatMediaRow({
  ids = [],
  titles = [],
  className = "",
}: {
  ids?: string[];
  titles?: string[];
  className?: string;
}) {
  const { data: assets } = useChatMedia(ids, titles);
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(() => (assets ?? []).filter((a) => a.url), [assets]);
  const active = items.find((a) => a.id === openId) ?? null;

  if (!items.length) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((a) => {
        const src = proxyMediaUrl(a.url as string);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenId(a.id)}
            title={a.title ?? undefined}
            className="relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-muted/40 transition hover:opacity-90"
          >
            {a.kind === "image" ? (
              <img src={src} alt={a.title ?? "Media"} loading="lazy" className="h-full w-full object-cover" />
            ) : a.kind === "video" ? (
              <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <KindIcon kind={a.kind} />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-background/75 px-1 py-0.5 text-[10px] text-foreground">
              {a.title ?? a.kind}
            </span>
          </button>
        );
      })}

      <Dialog open={!!active} onOpenChange={(v) => { if (!v) setOpenId(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl p-3">
          <DialogTitle className="pr-8 text-sm font-medium break-words">
            {active?.title ?? "Media"}
          </DialogTitle>
          {active?.url && (
            <div className="mt-2 flex max-h-[70svh] items-center justify-center overflow-hidden">
              {active.kind === "image" ? (
                <img
                  src={proxyMediaUrl(active.url)}
                  alt={active.title ?? "Media"}
                  className="max-h-[70svh] w-auto rounded-md object-contain"
                />
              ) : active.kind === "video" ? (
                <video src={proxyMediaUrl(active.url)} controls playsInline className="max-h-[70svh] w-full rounded-md" />
              ) : (
                <audio src={proxyMediaUrl(active.url)} controls className="w-full" />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
