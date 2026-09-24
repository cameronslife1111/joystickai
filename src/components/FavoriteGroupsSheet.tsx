import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const FAVORITE_SLOTS = 300;

type Group = { id: string; name: string; slots: (string | null)[] };

export function FavoriteGroupsSheet({
  favorites,
  locked,
  onLoad,
  onClose,
}: {
  favorites: (string | null)[];
  locked: boolean;
  onLoad: (slots: (string | null)[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("favorite_groups")
      .select("id, name, slots")
      .order("name");
    if (error) { toast.error("Couldn't load groups"); return; }
    setGroups((data ?? []).map((g: any) => ({ ...g, slots: Array.isArray(g.slots) ? g.slots : [] })));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (groups.some((g) => g.name === n) && !window.confirm(`Overwrite "${n}"?`)) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setBusy(false); return; }
    const slots = [...favorites];
    while (slots.length < FAVORITE_SLOTS) slots.push(null);
    const { error } = await supabase.from("favorite_groups").upsert(
      { user_id: u.user.id, name: n, slots: slots.slice(0, FAVORITE_SLOTS), updated_at: new Date().toISOString() } as any,
      { onConflict: "user_id,name" },
    );
    setBusy(false);
    if (error) { toast.error("Couldn't save group"); return; }
    toast.success(`⭐ Saved "${n}"`);
    setName("");
    void refresh();
  };

  const load = async (g: Group) => {
    if (locked) { toast.error("List is locked"); return; }
    const slots = [...g.slots].slice(0, FAVORITE_SLOTS);
    while (slots.length < FAVORITE_SLOTS) slots.push(null);
    await onLoad(slots);
    toast.success(`⭐ Loaded "${g.name}"`);
    onClose();
  };

  const rename = async (g: Group) => {
    const n = window.prompt("Rename group", g.name)?.trim();
    if (!n || n === g.name) return;
    const { error } = await supabase.from("favorite_groups").update({ name: n } as any).eq("id", g.id);
    if (error) { toast.error("Couldn't rename (name may be taken)"); return; }
    void refresh();
  };

  const remove = async (g: Group) => {
    if (!window.confirm(`Delete "${g.name}"?`)) return;
    const { error } = await supabase.from("favorite_groups").delete().eq("id", g.id);
    if (error) { toast.error("Couldn't delete"); return; }
    void refresh();
  };

  return (
    <div
      className="absolute inset-0 z-10 flex items-end justify-center bg-background/70 px-4 pb-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-3xl border border-foreground/10 bg-card/95 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="font-display text-base">Favorites groups</div>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Close</button>
        </div>
        <div className="mb-3 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
            placeholder="Name for current slots"
            className="min-w-0 flex-1 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {groups.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">No saved groups yet.</div>
          )}
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{g.name}</div>
                <div className="text-[11px] text-muted-foreground">{g.slots.filter(Boolean).length} documents</div>
              </div>
              <button onClick={() => void load(g)} className="rounded-lg bg-primary/15 px-2 py-1 text-xs">Load</button>
              <button onClick={() => void rename(g)} className="text-xs text-muted-foreground hover:text-foreground">Rename</button>
              <button onClick={() => void remove(g)} className="text-xs text-destructive/80 hover:text-destructive">Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
