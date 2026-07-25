import { useMemo, useState } from "react";
import {
  FolderPlus, Images, Inbox, MoreVertical, Pencil, Trash2, ChevronUp, ChevronDown,
  ChevronRight, Music, Play, Loader2,
} from "lucide-react";
import { proxyMediaUrl } from "@/lib/sb-proxy";
import type { MediaFolder } from "@/lib/media-folders";
import { ALL_MEDIA, UNSORTED } from "@/lib/media-folders";

type PreviewAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  url: string | null;
  title: string;
  status?: string | null;
};

interface Props {
  folders: MediaFolder[];
  assets: PreviewAsset[];
  byFolder: Map<string, Set<string>>;
  isLoading?: boolean;
  onOpenFolder: (folderId: string) => void;
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ordered: MediaFolder[]) => void;
}

function Thumb({ a }: { a: PreviewAsset }) {
  if (a.kind === "image" && a.url) {
    return (
      <img
        src={proxyMediaUrl(a.url)}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  }
  if (a.kind === "video" && a.url) {
    return (
      <div className="relative h-full w-full">
        <video src={proxyMediaUrl(a.url)} preload="metadata" muted playsInline className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Play className="h-3.5 w-3.5 text-white" />
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
    >
      {a.kind === "audio" ? <Music className="h-3.5 w-3.5 text-white" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}
    </div>
  );
}

function PreviewStrip({ items }: { items: PreviewAsset[] }) {
  if (items.length === 0) {
    return (
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl opacity-70"
        style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
      >
        <Images className="h-5 w-5 text-white" />
      </div>
    );
  }
  return (
    <div className="grid h-14 w-14 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-xl border border-foreground/10 bg-foreground/5">
      {items.slice(0, 4).map((a) => (
        <div key={a.id} className="overflow-hidden">
          <Thumb a={a} />
        </div>
      ))}
      {items.length === 1 && <div className="col-span-1 row-span-2" />}
    </div>
  );
}

function Row({
  icon, title, subtitle, preview, onClick, menu,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle: string;
  preview?: React.ReactNode;
  onClick: () => void;
  menu?: React.ReactNode;
}) {
  return (
    <div className="group relative flex items-center gap-3 rounded-2xl border border-foreground/10 bg-foreground/5 pr-2 transition hover:bg-foreground/10">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 text-left active:scale-[0.99]"
      >
        {preview ?? (
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {menu}
    </div>
  );
}

export function MediaFoldersView({
  folders, assets, byFolder, isLoading,
  onOpenFolder, onCreate, onRename, onDelete, onReorder,
}: Props) {
  const [menuFor, setMenuFor] = useState<MediaFolder | null>(null);
  const [renameFor, setRenameFor] = useState<MediaFolder | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleteFor, setDeleteFor] = useState<MediaFolder | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const filedIds = useMemo(() => {
    const s = new Set<string>();
    byFolder.forEach((set) => set.forEach((id) => s.add(id)));
    return s;
  }, [byFolder]);

  const unsorted = useMemo(() => assets.filter((a) => !filedIds.has(a.id)), [assets, filedIds]);

  const previewFor = (folderId: string) => {
    const ids = byFolder.get(folderId);
    if (!ids) return [];
    return assets.filter((a) => ids.has(a.id)).slice(0, 4);
  };

  const move = (index: number, delta: number) => {
    const next = [...folders];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
    setMenuFor(null);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-28">
      <div className="flex flex-col gap-2">
        <Row
          icon={<Images className="h-6 w-6" />}
          title="All Media"
          subtitle={`${assets.length} item${assets.length === 1 ? "" : "s"}`}
          onClick={() => onOpenFolder(ALL_MEDIA)}
        />
        <Row
          icon={<Inbox className="h-6 w-6" />}
          title="Unsorted"
          subtitle={`${unsorted.length} item${unsorted.length === 1 ? "" : "s"}`}
          onClick={() => onOpenFolder(UNSORTED)}
        />
      </div>

      <div className="my-4 h-px bg-foreground/10" />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-foreground/5" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No folders yet. Create one to start organizing your media.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {folders.map((f, i) => {
            const count = byFolder.get(f.id)?.size ?? 0;
            return (
              <li key={f.id}>
                <Row
                  title={f.name}
                  subtitle={`${count} item${count === 1 ? "" : "s"}`}
                  preview={<PreviewStrip items={previewFor(f.id)} />}
                  onClick={() => onOpenFolder(f.id)}
                  menu={
                    <button
                      type="button"
                      aria-label={`Options for ${f.name}`}
                      onClick={(e) => { e.stopPropagation(); setMenuFor(f); }}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  }
                />
                {menuFor?.id === f.id && (
                  <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
                    onClick={() => setMenuFor(null)}
                  >
                    <div
                      className="w-full max-w-md rounded-t-3xl border border-foreground/10 bg-card p-4"
                      onClick={(e) => e.stopPropagation()}
                      style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
                    >
                      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/20" />
                      <p className="mb-3 truncate text-center font-display text-base">{f.name}</p>
                      <div className="flex flex-col gap-1.5">
                        <MenuButton
                          icon={<Pencil className="h-4 w-4" />}
                          label="Rename folder"
                          onClick={() => { setRenameText(f.name); setRenameFor(f); setMenuFor(null); }}
                        />
                        <MenuButton
                          icon={<ChevronUp className="h-4 w-4" />}
                          label="Move up"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        />
                        <MenuButton
                          icon={<ChevronDown className="h-4 w-4" />}
                          label="Move down"
                          disabled={i === folders.length - 1}
                          onClick={() => move(i, 1)}
                        />
                        <MenuButton
                          icon={<Trash2 className="h-4 w-4" />}
                          label="Delete folder"
                          danger
                          onClick={() => { setDeleteFor(f); setMenuFor(null); }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* New folder */}
      <div className="mt-3">
        {creating ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  const n = newName.trim();
                  if (!n) return;
                  setNewName(""); setCreating(false);
                  await onCreate(n);
                }
                if (e.key === "Escape") { setCreating(false); setNewName(""); }
              }}
              placeholder="Folder name"
              className="min-w-0 flex-1 rounded-xl border border-foreground/15 bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50"
            />
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={async () => {
                const n = newName.trim();
                if (!n) return;
                setNewName(""); setCreating(false);
                await onCreate(n);
              }}
              className="shrink-0 rounded-xl border border-primary/40 bg-primary/15 px-3 py-2.5 text-sm text-primary disabled:opacity-40"
            >
              Create
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/20 px-3 py-3 text-sm text-muted-foreground transition hover:bg-foreground/5 active:scale-[0.99]"
          >
            <FolderPlus className="h-4 w-4" /> New folder
          </button>
        )}
      </div>

      {/* Rename dialog */}
      {renameFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setRenameFor(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 font-display text-base">Rename folder</p>
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onRename(renameFor.id, renameText); setRenameFor(null); }
                if (e.key === "Escape") setRenameFor(null);
              }}
              className="mb-4 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameFor(null)}
                className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => { onRename(renameFor.id, renameText); setRenameFor(null); }}
                className="rounded-xl border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-primary hover:bg-primary/25"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setDeleteFor(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 font-display text-base">Delete "{deleteFor.name}"?</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Your media is safe — the items just move back to Unsorted (unless they're also in another folder).
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteFor(null)}
                className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete(deleteFor.id); setDeleteFor(null); }}
                className="rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive hover:bg-destructive/25"
              >
                Delete folder
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MenuButton({
  icon, label, onClick, danger, disabled,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "flex min-h-[48px] w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition active:scale-[0.98] disabled:opacity-40 " +
        (danger
          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10")
      }
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/5">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
