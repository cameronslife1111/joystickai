import { useState } from "react";
import { FolderPlus, Check, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { MediaFolder } from "@/lib/media-folders";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  folders: MediaFolder[];
  /** Folder ids to mark as already containing the media. */
  markedIds?: string[];
  /** Folder id to hide (e.g. the folder you're already inside). */
  excludeId?: string | null;
  busy?: boolean;
  onPick: (folderId: string) => void;
  onCreate: (name: string) => Promise<string | null>;
}

export function FolderPickerSheet({
  open,
  onOpenChange,
  title,
  description,
  folders,
  markedIds = [],
  excludeId = null,
  busy = false,
  onPick,
  onCreate,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const visible = folders.filter((f) => f.id !== excludeId);

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const id = await onCreate(name);
    setSaving(false);
    setNewName("");
    setCreating(false);
    if (id) onPick(id);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[80vh] flex-col">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </SheetHeader>

        <div className="-mx-6 flex-1 overflow-y-auto px-6 py-3">
          {visible.length === 0 && !creating ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No folders yet — create one below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map((f) => {
                const marked = markedIds.includes(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onPick(f.id)}
                      className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-3 text-left transition hover:bg-foreground/10 active:scale-[0.99] disabled:opacity-50"
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
                      >
                        <span className="text-xs">🗂</span>
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                      {marked && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          className="sticky bottom-0 border-t border-foreground/10 bg-background pt-3"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
        >
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNew();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="Folder name"
                className="min-w-0 flex-1 rounded-xl border border-foreground/15 bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50"
              />
              <button
                type="button"
                disabled={saving || !newName.trim()}
                onClick={() => void submitNew()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/15 px-3 py-2.5 text-sm text-primary disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Create
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/20 px-3 py-3 text-sm text-muted-foreground transition hover:bg-foreground/5"
            >
              <FolderPlus className="h-4 w-4" /> New folder
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
