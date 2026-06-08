import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { sortDocsByTitle } from "@/lib/sortDocs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSelectedIds: string[];
  onConfirm: (selectedIds: string[]) => void;
}

type Doc = { id: string; title: string; sentence_count: number };

export function DocumentPickerSheet({ open, onOpenChange, initialSelectedIds, onConfirm }: Props) {
  const [selected, setSelected] = useState<string[]>(initialSelectedIds);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(initialSelectedIds);
      setQuery("");
    }
  }, [open, initialSelectedIds]);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents_with_counts"],
    enabled: open,
    queryFn: async (): Promise<Doc[]> => {
      const { data: documents, error } = await supabase
        .from("documents")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const ids = (documents ?? []).map((d) => d.id);
      if (ids.length === 0) return [];
      const { data: sentences } = await supabase
        .from("sentences")
        .select("document_id")
        .in("document_id", ids);
      const counts = new Map<string, number>();
      (sentences ?? []).forEach((s: any) => {
        counts.set(s.document_id, (counts.get(s.document_id) ?? 0) + 1);
      });
      return sortDocsByTitle(
        (documents ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          sentence_count: counts.get(d.id) ?? 0,
        }))
      );
    },
  });

  const toggle = (id: string) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[80vh] flex-col">
        <SheetHeader>
          <SheetTitle>Attach documents</SheetTitle>
        </SheetHeader>
        <div className="-mx-6 flex-1 overflow-y-auto px-6 py-2">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {docs.map((d) => {
                const checked = selected.includes(d.id);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => toggle(d.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-left transition hover:bg-foreground/10"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(d.id)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{d.title || "Untitled"}</p>
                        <p className="text-xs text-muted-foreground">
                          ({d.sentence_count} sentence{d.sentence_count === 1 ? "" : "s"})
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div
          className="sticky bottom-0 border-t border-foreground/10 bg-background pt-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <Button
            className="w-full"
            onClick={() => {
              onConfirm(selected);
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
