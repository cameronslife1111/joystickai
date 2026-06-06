import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { suggestDocumentPlans, type PlanSuggestion } from "@/lib/plan-suggestions.functions";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  documentId: string | null;
  documentTitle: string | null;
  onPickSuggestion: (request: string) => void;
}

export function DocSuggestionsOrb({ documentId, documentTitle, onPickSuggestion }: Props) {
  const [open, setOpen] = useState(false);
  const suggestFn = useServerFn(suggestDocumentPlans);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["doc_suggestions", documentId],
    enabled: !!documentId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<PlanSuggestion[]> => {
      if (!documentId) return [];
      const res = await suggestFn({ data: { documentId } });
      return res.suggestions ?? [];
    },
  });

  if (!documentId) return null;

  const suggestions = data ?? [];
  const ready = !isFetching && suggestions.length > 0;
  // Nothing actionable found and not loading → keep the orb hidden.
  if (!isFetching && data !== undefined && suggestions.length === 0) return null;

  return (
    <div
      className="fixed left-3 z-30"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ready ? "Plan suggestions ready" : "Thinking up suggestions"}
            className={cn(
              "relative grid h-10 w-10 place-items-center rounded-full border backdrop-blur transition active:scale-95",
              ready
                ? "border-yellow-400/60 bg-yellow-400/15 text-yellow-300 shadow-[0_0_24px_-6px_rgba(250,204,21,0.7)]"
                : "border-border bg-card/80 text-muted-foreground",
            )}
          >
            {ready ? (
              <Sparkles className="h-5 w-5" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin opacity-70" />
            )}
            {ready && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-yellow-400 ring-2 ring-background" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-1.5rem))] p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold">Orby suggestions</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {documentTitle || "This document"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
              aria-label="Refresh suggestions"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {isFetching ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                Reading your document…
              </p>
            ) : suggestions.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No suggestions right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onPickSuggestion(s.request);
                      }}
                      className="flex w-full items-start gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-left text-sm transition hover:border-primary/50 hover:bg-primary/10 active:scale-[0.99]"
                    >
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
