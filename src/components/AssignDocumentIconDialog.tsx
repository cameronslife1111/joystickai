import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { sortDocsByTitle } from "@/lib/sortDocs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaAssetId: string;
  mediaAssetTitle: string;
}

export function AssignDocumentIconDialog({
  open,
  onOpenChange,
  mediaAssetId,
  mediaAssetTitle,
}: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: docs = [] } = useQuery({
    queryKey: ["documents_for_icon"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title")
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; title: string }[];
    },
  });

  const { data: existing = [] } = useQuery({
    queryKey: ["document_icons_for_asset", mediaAssetId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_icons")
        .select("document_id")
        .eq("media_asset_id", mediaAssetId);
      if (error) throw error;
      return (data ?? []).map((r) => r.document_id as string);
    },
  });

  useEffect(() => {
    if (open) {
      const s = new Set(existing);
      setSelected(s);
      setInitial(s);
      setSearch("");
    }
  }, [open, existing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? docs.filter((d) => (d.title ?? "").toLowerCase().includes(q))
      : docs;
    return sortDocsByTitle(list);
  }, [docs, search]);

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Not signed in");

      const toAdd = [...selected].filter((id) => !initial.has(id));
      const toRemove = [...initial].filter((id) => !selected.has(id));

      if (toAdd.length > 0) {
        const rows = toAdd.map((document_id) => ({
          document_id,
          user_id: userId,
          media_asset_id: mediaAssetId,
        }));
        const { error } = await supabase
          .from("document_icons")
          .upsert(rows, { onConflict: "document_id" });
        if (error) throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("document_icons")
          .delete()
          .in("document_id", toRemove)
          .eq("media_asset_id", mediaAssetId);
        if (error) throw error;
      }

      qc.invalidateQueries({ queryKey: ["document_icons_for_asset", mediaAssetId] });
      qc.invalidateQueries({ queryKey: ["document_icon"] });
      toast.success(
        selected.size === 0
          ? "Icon removed from all documents"
          : `Icon assigned to ${selected.size} document${selected.size === 1 ? "" : "s"}`,
      );
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[85vh] flex-col">
        <SheetHeader>
          <SheetTitle>Set as document icon</SheetTitle>
          <p className="truncate text-xs text-muted-foreground">
            "{mediaAssetTitle}" will replace Orby on the selected documents.
          </p>
        </SheetHeader>
        <div className="pt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="-mx-6 flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No documents found.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((d) => {
                const on = selected.has(d.id);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => toggle(d.id)}
                      className={
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition " +
                        (on
                          ? "border-primary/40 bg-primary/10"
                          : "border-foreground/10 bg-background hover:bg-foreground/5")
                      }
                    >
                      <span className="truncate">{d.title || "Untitled"}</span>
                      <span
                        className={
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] " +
                          (on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-foreground/25")
                        }
                      >
                        {on ? "✓" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div
          className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-foreground/10 bg-background pt-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <p className="text-xs text-muted-foreground">
            Selected: {selected.size}
          </p>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
