import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Play, Music, X, Pencil, Download,
  RefreshCw, Film, Video, Trash2, MoreVertical, Sparkles, Loader2, AlertCircle, Layers, Mic2, Copy,
  CheckSquare, CheckCircle2,
} from "lucide-react";
import { GenerateImageDialog } from "@/components/GenerateImageDialog";
import { RegenerateImageDialog } from "@/components/RegenerateImageDialog";
import { RemixImagesDialog } from "@/components/RemixImagesDialog";
import { ImageToVideoDialog } from "@/components/ImageToVideoDialog";
import { VideoToVideoDialog } from "@/components/VideoToVideoDialog";
import { AudioImageToVideoDialog } from "@/components/AudioImageToVideoDialog";
import { useVideoJobPolling } from "@/hooks/use-video-job-polling";
import { useRunningPlansAdvancer } from "@/hooks/use-running-plans-advancer";
import { useDownloadAll } from "@/hooks/use-download-all";
import { DownloadAllProgress } from "@/components/DownloadAllProgress";

const NO_CALLOUT_STYLE: React.CSSProperties = {
  WebkitTouchCallout: "none",
  WebkitUserSelect: "none",
  userSelect: "none",
};
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/media")({
  head: () => ({ meta: [{ title: "Media Gallery · Orby" }] }),
  component: MediaPage,
});

type Kind = "image" | "video" | "audio";
type AssetStatus = "generating" | "completed" | "failed" | null;
type Asset = {
  id: string;
  user_id: string;
  title: string;
  kind: Kind;
  url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  seen_at: string | null;
  created_at: string;
  status?: AssetStatus;
  error_message?: string | null;
};
type Filter = "all" | "image" | "video" | "audio";

const BUCKET = "joystick-media";

function detectKind(mime: string, name?: string): Kind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  // Fallback: infer from extension when browser reports empty mime
  const ext = (name?.split(".").pop() ?? "").toLowerCase();
  if (["jpg","jpeg","png","gif","webp","heic","heif","avif","bmp","svg"].includes(ext)) return "image";
  if (["mp4","mov","webm","mkv","avi","m4v","3gp"].includes(ext)) return "video";
  if (["mp3","wav","m4a","aac","ogg","flac","opus","weba"].includes(ext)) return "audio";
  return null;
}

function stripExt(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

async function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
async function probeVideo(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve({ width: v.videoWidth, height: v.videoHeight, duration: isFinite(v.duration) ? v.duration : 0 });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => { resolve({ width: 0, height: 0, duration: 0 }); URL.revokeObjectURL(url); };
    v.src = url;
  });
}
async function probeAudio(file: File): Promise<{ duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => { resolve({ duration: isFinite(a.duration) ? a.duration : 0 }); URL.revokeObjectURL(url); };
    a.onerror = () => { resolve({ duration: 0 }); URL.revokeObjectURL(url); };
    a.src = url;
  });
}

function MediaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const downloadAll = useDownloadAll();
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [sheetAsset, setSheetAsset] = useState<Asset | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [regenerateAsset, setRegenerateAsset] = useState<Asset | null>(null);
  const [remixAsset, setRemixAsset] = useState<Asset | null>(null);
  const [failedAsset, setFailedAsset] = useState<Asset | null>(null);
  const [i2vAsset, setI2vAsset] = useState<Asset | null>(null);
  const [v2vAsset, setV2vAsset] = useState<Asset | null>(null);
  const [aivAsset, setAivAsset] = useState<Asset | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useVideoJobPolling(userId);
  useRunningPlansAdvancer(
    userId,
    () => toast.success("Your plan is done"),
    () => toast.error("A plan failed"),
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Realtime subscription so generating thumbnails flip to completed automatically
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`media_assets_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "media_assets", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["media_assets"] });
          qc.invalidateQueries({ queryKey: ["media_unseen_count"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["media_assets"],
    queryFn: async (): Promise<Asset[]> => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Asset[];
    },
  });

  const filtered = useMemo(
    () => filter === "all" ? assets : assets.filter((a) => a.kind === filter),
    [assets, filter],
  );

  const markSeen = useCallback(async (asset: Asset) => {
    if (asset.seen_at) return;
    qc.setQueryData<Asset[]>(["media_assets"], (prev) =>
      prev?.map((a) => a.id === asset.id ? { ...a, seen_at: new Date().toISOString() } : a) ?? prev,
    );
    await supabase.from("media_assets").update({ seen_at: new Date().toISOString() }).eq("id", asset.id);
    qc.invalidateQueries({ queryKey: ["media_unseen_count"] });
  }, [qc]);

  const openViewer = useCallback((idx: number) => {
    setViewerIdx(idx);
    setChromeVisible(true);
    const a = filtered[idx];
    if (a) void markSeen(a);
  }, [filtered, markSeen]);


  // Upload
  const handleFilesPicked = useCallback(async (files: FileList | null) => {
    console.log("[media] handleFilesPicked", { count: files?.length ?? 0 });
    if (!files || files.length === 0) return;
    const { data: u, error: authErr } = await supabase.auth.getUser();
    console.log("[media] auth", { user: u?.user?.id, authErr });
    if (!u.user) { toast.error("Not signed in"); return; }
    const userId = u.user.id;
    const arr = Array.from(files);
    toast.info(`Uploading ${arr.length} file${arr.length === 1 ? "" : "s"}…`);
    setUploadProgress({ done: 0, total: arr.length });
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      console.log("[media] file", { name: file.name, type: file.type, size: file.size });
      try {
        const kind = detectKind(file.type || "", file.name);
        if (!kind) {
          toast.error(`Unsupported file type: ${file.name}`);
          setUploadProgress({ done: i + 1, total: arr.length });
          continue;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${userId}/${Date.now()}_${safeName}`;
        console.log("[media] uploading to", path);
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type || "application/octet-stream", upsert: false,
        });
        if (upErr) { console.error("[media] storage upload error", upErr); throw upErr; }
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const url = pub.publicUrl;
        console.log("[media] uploaded, public url", url);

        let width: number | null = null;
        let height: number | null = null;
        let duration: number | null = null;
        if (kind === "image") {
          const m = await probeImage(file);
          width = m.width || null; height = m.height || null;
        } else if (kind === "video") {
          const m = await probeVideo(file);
          width = m.width || null; height = m.height || null; duration = m.duration || null;
        } else if (kind === "audio") {
          const m = await probeAudio(file);
          duration = m.duration || null;
        }

        const { error: insErr } = await supabase.from("media_assets").insert({
          user_id: userId,
          title: stripExt(file.name),
          kind,
          url,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          duration_seconds: duration,
          width,
          height,
        });
        if (insErr) { console.error("[media] db insert error", insErr); throw insErr; }
        console.log("[media] inserted row for", file.name);
      } catch (e: any) {
        console.error("[media] upload failed", file.name, e);
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      } finally {
        setUploadProgress({ done: i + 1, total: arr.length });
      }
    }
    setUploadProgress(null);
    toast.success("Upload complete");
    qc.invalidateQueries({ queryKey: ["media_assets"] });
    qc.invalidateQueries({ queryKey: ["media_unseen_count"] });
  }, [qc]);

  const handleRename = useCallback(async () => {
    if (!sheetAsset) return;
    const title = renameText.trim() || "Untitled";
    qc.setQueryData<Asset[]>(["media_assets"], (prev) =>
      prev?.map((a) => a.id === sheetAsset.id ? { ...a, title } : a) ?? prev,
    );
    await supabase.from("media_assets").update({ title }).eq("id", sheetAsset.id);
    setRenameOpen(false);
    setSheetAsset(null);
    toast.success("Renamed");
  }, [renameText, sheetAsset, qc]);

  const handleDownload = useCallback(async (asset: Asset) => {
    if (!asset.url) { toast.error("No file to download yet"); setSheetAsset(null); return; }
    try {
      const res = await fetch(asset.url);
      const blob = await res.blob();
      const ext = (asset.storage_path ?? "").split(".").pop() ?? "";
      const fname = ext ? `${asset.title}.${ext}` : asset.title;
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    }
    setSheetAsset(null);
  }, []);

  const deleteAsset = useCallback(async (a: Asset) => {
    const viewing = viewerIdx !== null && filtered[viewerIdx]?.id === a.id;
    qc.setQueryData<Asset[]>(["media_assets"], (prev) => prev?.filter((x) => x.id !== a.id) ?? prev);
    if (viewing) setViewerIdx(null);
    const { error: delErr } = await supabase.from("media_assets").delete().eq("id", a.id);
    if (delErr) { toast.error(delErr.message); return; }
    if (a.storage_path) await supabase.storage.from(BUCKET).remove([a.storage_path]);
    qc.invalidateQueries({ queryKey: ["media_assets"] });
    qc.invalidateQueries({ queryKey: ["media_unseen_count"] });
    toast.success("Deleted");
  }, [qc, viewerIdx, filtered]);

  const handleDelete = useCallback(async () => {
    if (!sheetAsset) return;
    const a = sheetAsset;
    setConfirmDelete(false);
    setSheetAsset(null);
    await deleteAsset(a);
  }, [sheetAsset, deleteAsset]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmBatchDelete(false);
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    const ids = Array.from(selectedIds);
    const all = qc.getQueryData<Asset[]>(["media_assets"]) ?? [];
    const targets = all.filter((a) => selectedIds.has(a.id));
    const paths = targets.map((a) => a.storage_path).filter((p): p is string => !!p);

    // Optimistic remove from cache
    qc.setQueryData<Asset[]>(["media_assets"], (prev) => prev?.filter((x) => !selectedIds.has(x.id)) ?? prev);

    let storageFailed = 0;
    if (paths.length > 0) {
      const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) {
        storageFailed = paths.length;
      } else {
        const removed = new Set((data ?? []).map((d: any) => d.name as string));
        storageFailed = paths.filter((p) => !removed.has(p)).length;
      }
    }

    const { error: delErr } = await supabase.from("media_assets").delete().in("id", ids);
    if (delErr) {
      toast.error(delErr.message);
      qc.invalidateQueries({ queryKey: ["media_assets"] });
      setBatchDeleting(false);
      return;
    }

    qc.invalidateQueries({ queryKey: ["media_assets"] });
    qc.invalidateQueries({ queryKey: ["media_unseen_count"] });
    if (storageFailed > 0) {
      toast.success(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"} (${storageFailed} storage file${storageFailed === 1 ? "" : "s"} could not be removed)`);
    } else {
      toast.success(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`);
    }
    setBatchDeleting(false);
    exitSelectMode();
  }, [selectedIds, qc, exitSelectMode]);

  // Viewer keyboard + swipe
  useEffect(() => {
    if (viewerIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewerIdx(null);
      else if (e.key === "ArrowRight") advanceViewer(1);
      else if (e.key === "ArrowLeft") advanceViewer(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIdx, filtered]);

  const advanceViewer = useCallback((delta: number) => {
    setViewerIdx((cur) => {
      if (cur === null) return cur;
      const next = cur + delta;
      if (next < 0 || next >= filtered.length) return cur;
      const a = filtered[next];
      if (a) void markSeen(a);
      return next;
    });
  }, [filtered, markSeen]);

  const currentAsset = viewerIdx !== null ? filtered[viewerIdx] : null;

  return (
    <main
      className="relative flex h-[100svh] flex-col overflow-y-auto overscroll-contain bg-background text-foreground"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Background flourish */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[40vh] w-[80vw] -translate-x-1/2 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--aurora-2), transparent 70%)" }} />
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-foreground/10 bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate({ to: "/app" })}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 transition active:scale-95 hover:bg-foreground/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => {
              if (selectMode) exitSelectMode();
              else setSelectMode(true);
            }}
            aria-label={selectMode ? "Exit multi-select" : "Multi-select"}
            title={selectMode ? "Exit multi-select" : "Select multiple"}
            className={
              "flex h-10 w-10 items-center justify-center rounded-full border transition active:scale-95 " +
              (selectMode
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-foreground/10 hover:bg-foreground/10")
            }
          >
            <CheckSquare className="h-5 w-5" />
          </button>
        </div>
        <h1 className="font-display text-lg">
          {selectMode ? `${selectedIds.size} selected` : "Media Gallery"}
        </h1>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <button
                type="button"
                disabled={selectedIds.size === 0 || batchDeleting}
                onClick={() => setConfirmBatchDelete(true)}
                aria-label={`Delete ${selectedIds.size} items`}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/15 px-3 text-destructive transition active:scale-95 hover:bg-destructive/25 disabled:opacity-40"
              >
                {batchDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span className="text-sm">{selectedIds.size}</span>
              </button>
              <button
                type="button"
                onClick={exitSelectMode}
                aria-label="Cancel selection"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 transition active:scale-95 hover:bg-foreground/10"
              >
                <X className="h-5 w-5" />
              </button>
            </>
          ) : (
            <>
              {(() => {
                const downloadable = filtered.filter(
                  (a) => a.url && (a.status === "completed" || !a.status),
                );
                const busy = downloadAll.progress
                  && downloadAll.progress.phase !== "done"
                  && downloadAll.progress.phase !== "error"
                  && downloadAll.progress.phase !== "cancelled";
                const disabled = downloadable.length === 0 || !!busy;
                const filterLabel = filter === "all" ? "media" : `${filter}s`;
                return (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      downloadAll.start(
                        downloadable.map((a) => ({
                          id: a.id,
                          title: a.title,
                          kind: a.kind,
                          url: a.url,
                          mime_type: a.mime_type,
                          size_bytes: a.size_bytes,
                        })),
                        filterLabel,
                      );
                    }}
                    aria-label={`Download all ${filterLabel}`}
                    title={
                      downloadable.length === 0
                        ? "Nothing to download yet"
                        : `Download all ${filterLabel} (${downloadable.length})`
                    }
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 transition active:scale-95 hover:bg-foreground/10 disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                  </button>
                );
              })()}
              <button
                onClick={() => {
                  console.log("[media] + clicked, input ref:", !!fileInputRef.current);
                  fileInputRef.current?.click();
                }}
                aria-label="Upload media"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary transition active:scale-95 hover:bg-primary/20"
              >
                <Plus className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Select-all bar */}
      {selectMode && (
        <div className="flex items-center justify-between gap-2 border-b border-foreground/10 bg-foreground/5 px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedIds.size === 0 ? "Tap items to select" : `${selectedIds.size} of ${filtered.length} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(filtered.map((a) => a.id)))}
              className="rounded-full border border-foreground/10 px-3 py-1 hover:bg-foreground/10"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setSelectedIds(new Set())}
              className="rounded-full border border-foreground/10 px-3 py-1 hover:bg-foreground/10 disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {([
          { id: "all", label: "All" },
          { id: "image", label: "Images" },
          { id: "video", label: "Videos" },
          { id: "audio", label: "Audio" },
        ] as { id: Filter; label: string }[]).map((c) => {
          const active = filter === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={
                "shrink-0 rounded-full border px-4 py-1.5 text-sm transition active:scale-95 " +
                (active
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:bg-foreground/10")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Upload progress banner */}
      {uploadProgress && (
        <div className="mx-4 mb-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-center text-sm text-primary">
          Uploading {Math.min(uploadProgress.done + 1, uploadProgress.total)} of {uploadProgress.total}…
        </div>
      )}

      {/* Grid */}
      <section className="px-4 pb-8">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-2xl bg-foreground/5" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center text-center text-muted-foreground">
            <p className="text-lg">Nothing here yet.</p>
            <p className="text-sm">Tap + to upload.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {filtered.map((a, i) => {
              const isGenerating = a.status === "generating";
              const isFailed = a.status === "failed";
              const isSelected = selectedIds.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    if (selectMode) {
                      if (isGenerating) return;
                      toggleSelected(a.id);
                      return;
                    }
                    if (isGenerating) return;
                    if (isFailed) { setFailedAsset(a); return; }
                    openViewer(i);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (selectMode) return;
                    if (isGenerating) return;
                    setSheetAsset(a);
                  }}
                  style={NO_CALLOUT_STYLE}
                  className={
                    "group relative aspect-square overflow-hidden rounded-2xl border bg-foreground/5 transition active:scale-95 " +
                    (selectMode && isSelected
                      ? "border-primary ring-2 ring-primary"
                      : "border-foreground/10")
                  }
                >
                  {isGenerating ? (
                    <div
                      className="flex h-full w-full flex-col items-center justify-center gap-2 p-2"
                      style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--aurora-1) 25%, transparent), color-mix(in oklab, var(--aurora-2) 25%, transparent))" }}
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-foreground/80" />
                      <span className="text-[10px] text-foreground/80">Generating...</span>
                    </div>
                  ) : isFailed ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-destructive/10 p-2">
                      <AlertCircle className="h-6 w-6 text-destructive" />
                      <span className="text-[10px] text-destructive">Failed</span>
                    </div>
                  ) : (
                    <>
                      {a.kind === "image" && a.url && (
                        <img
                          src={a.url}
                          alt={a.title}
                          loading="lazy"
                          draggable={false}
                          style={NO_CALLOUT_STYLE}
                          className="h-full w-full object-cover"
                        />
                      )}
                      {a.kind === "video" && a.url && (
                        <>
                          <video src={a.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="h-10 w-10 text-white drop-shadow" />
                          </div>
                        </>
                      )}
                      {a.kind === "audio" && (
                        <div
                          className="flex h-full w-full flex-col items-center justify-center gap-2 p-2 text-center"
                          style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
                        >
                          <Music className="h-8 w-8 text-white" />
                          <span className="line-clamp-2 text-[10px] text-white/90">{a.title}</span>
                        </div>
                      )}
                      {!a.seen_at && !selectMode && (
                        <span
                          className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background"
                          style={{ background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))" }}
                        />
                      )}
                    </>
                  )}
                  {selectMode && (
                    <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 backdrop-blur">
                      {isSelected
                        ? <CheckCircle2 className="h-5 w-5 text-primary" />
                        : <span className="h-4 w-4 rounded-full border-2 border-foreground/40" />}
                    </span>
                  )}
                  {selectMode && isSelected && (
                    <span className="pointer-events-none absolute inset-0 bg-primary/15" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const input = e.currentTarget;
          const picked = input.files;
          console.log("[media] input onChange, files:", picked?.length ?? 0);
          // Snapshot files into a new FileList-like array before resetting input
          const snapshot = picked ? Array.from(picked) : [];
          input.value = "";
          // Re-wrap in a DataTransfer to preserve FileList shape
          const dt = new DataTransfer();
          snapshot.forEach((f) => dt.items.add(f));
          void handleFilesPicked(dt.files);
        }}
      />

      {/* Full-screen viewer */}
      {currentAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black"
          onTouchStart={(e) => {
            const t = e.touches[0];
            swipeStartRef.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (!start) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
              if (dx < 0) advanceViewer(1);
              else advanceViewer(-1);
            }
          }}
          onClick={(e) => {
            const w = (e.currentTarget as HTMLElement).clientWidth;
            const x = e.clientX;
            const third = w / 3;
            if (x < third) advanceViewer(-1);
            else if (x > w - third) advanceViewer(1);
            else setChromeVisible((v) => !v);
          }}
        >
          {/* Asset */}
          <div className="flex h-full w-full items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            {currentAsset.status === "generating" ? (
              <div className="flex flex-col items-center gap-3 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">Generating...</span>
              </div>
            ) : currentAsset.status === "failed" ? (
              <div className="flex flex-col items-center gap-3 text-white">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <span className="text-sm">{currentAsset.error_message ?? "Generation failed"}</span>
              </div>
            ) : (
              <>
                {currentAsset.kind === "image" && currentAsset.url && (
                  <img
                    src={currentAsset.url}
                    alt={currentAsset.title}
                    draggable={false}
                    style={NO_CALLOUT_STYLE}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
                {currentAsset.kind === "video" && currentAsset.url && (
                  <video src={currentAsset.url} controls playsInline className="max-h-full max-w-full" />
                )}
                {currentAsset.kind === "audio" && currentAsset.url && (
                  <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white">
                    <Music className="mx-auto mb-3 h-10 w-10" />
                    <p className="mb-4 font-display text-lg">{currentAsset.title}</p>
                    <audio src={currentAsset.url} controls className="w-full" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Chrome */}
          {chromeVisible && (
            <>
              <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                {viewerIdx! + 1} / {filtered.length}
              </div>
              <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 max-w-[calc(100vw-10rem)] rounded-full bg-black/60 px-3 py-1 text-center text-[11px] text-white">
                <span className="block truncate">{currentAsset.title || "Untitled"}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setSheetAsset(currentAsset); }}
                aria-label="Options"
                className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white"
                style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setViewerIdx(null); }}
                aria-label="Close"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Long-press action sheet */}
      {sheetAsset && !renameOpen && !confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setSheetAsset(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl border border-foreground/10 bg-card p-4"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mb-3 px-2">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/20" />
              <p className="truncate text-center font-display text-base">{sheetAsset.title}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <SheetButton icon={<Pencil className="h-4 w-4" />} label="Rename"
                onClick={() => { setRenameText(sheetAsset.title); setRenameOpen(true); }}
              />
              <SheetButton icon={<Download className="h-4 w-4" />} label="Download"
                onClick={() => handleDownload(sheetAsset)}
              />
              {sheetAsset.kind === "image" && (
                <SheetButton icon={<RefreshCw className="h-4 w-4" />} label="Regenerate"
                  onClick={() => { const a = sheetAsset; setSheetAsset(null); setRegenerateAsset(a); }}
                />
              )}
              {sheetAsset.kind === "image" && (
                <SheetButton icon={<Layers className="h-4 w-4" />} label="Remix"
                  onClick={() => { const a = sheetAsset; setSheetAsset(null); setRemixAsset(a); }}
                />
              )}
              {sheetAsset.kind === "image" && (
                <SheetButton icon={<Film className="h-4 w-4" />} label="Image to Video"
                  onClick={() => {
                    const a = sheetAsset;
                    setSheetAsset(null);
                    setViewerIdx(null);
                    setI2vAsset(a);
                  }}
                />
              )}
              {sheetAsset.kind === "image" && (
                <SheetButton icon={<Video className="h-4 w-4" />} label="Video to Video"
                  onClick={() => {
                    const a = sheetAsset;
                    setSheetAsset(null);
                    setViewerIdx(null);
                    setV2vAsset(a);
                  }}
                />
              )}
              {sheetAsset.kind === "image" && (
                <SheetButton icon={<Mic2 className="h-4 w-4" />} label="Audio + Image to Video"
                  onClick={() => {
                    const a = sheetAsset;
                    setSheetAsset(null);
                    setViewerIdx(null);
                    setAivAsset(a);
                  }}
                />
              )}
              <SheetButton icon={<Trash2 className="h-4 w-4" />} label="Delete" danger
                onClick={() => setConfirmDelete(true)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {sheetAsset && renameOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => { setRenameOpen(false); setSheetAsset(null); }}
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
              onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); if (e.key === "Escape") { setRenameOpen(false); setSheetAsset(null); } }}
              className="mb-4 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRenameOpen(false); setSheetAsset(null); }}
                className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(renameText);
                    toast.success("Copied to clipboard");
                  } catch {
                    toast.error("Could not copy");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm text-foreground hover:bg-foreground/5"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
              <button onClick={handleRename}
                className="rounded-xl border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-primary hover:bg-primary/25">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {sheetAsset && confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 font-display text-base">Delete this from your gallery?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)}
                className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={handleDelete}
                className="rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive hover:bg-destructive/25">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch delete confirm */}
      {confirmBatchDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => { if (!batchDeleting) setConfirmBatchDelete(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 font-display text-base">
              Delete {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}?
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              This removes the files from your gallery and storage. This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                disabled={batchDeleting}
                onClick={() => setConfirmBatchDelete(false)}
                className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                disabled={batchDeleting}
                onClick={() => { setConfirmBatchDelete(false); void handleBatchDelete(); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive hover:bg-destructive/25 disabled:opacity-40"
              >
                {batchDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Generate FAB — hidden when viewer is open */}
      {viewerIdx === null && (
        <button
          onClick={() => setGenerateOpen(true)}
          aria-label="Generate image"
          className="fixed right-4 z-30 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg transition active:scale-95"
          style={{
            bottom: "calc(1rem + env(safe-area-inset-bottom))",
            background: "linear-gradient(135deg, var(--aurora-1), var(--aurora-2))",
          }}
        >
          <Sparkles className="h-4 w-4" />
          Generate
        </button>
      )}

      <GenerateImageDialog open={generateOpen} onOpenChange={setGenerateOpen} />

      {regenerateAsset && (
        <RegenerateImageDialog
          open={!!regenerateAsset}
          onOpenChange={(o) => { if (!o) setRegenerateAsset(null); }}
          sourceAsset={{ id: regenerateAsset.id, url: regenerateAsset.url, title: regenerateAsset.title }}
          onSubmitted={() => { setRegenerateAsset(null); setViewerIdx(null); }}
        />
      )}

      {remixAsset && (
        <RemixImagesDialog
          open={!!remixAsset}
          onOpenChange={(o) => { if (!o) setRemixAsset(null); }}
          initialAsset={{ id: remixAsset.id, url: remixAsset.url, title: remixAsset.title }}
          onSubmitted={() => { setRemixAsset(null); setViewerIdx(null); }}
        />
      )}

      {i2vAsset && (
        <ImageToVideoDialog
          open={!!i2vAsset}
          onOpenChange={(o) => { if (!o) setI2vAsset(null); }}
          sourceImage={{ id: i2vAsset.id, url: i2vAsset.url, title: i2vAsset.title }}
          onSubmitted={() => setI2vAsset(null)}
        />
      )}

      {aivAsset && (
        <AudioImageToVideoDialog
          open={!!aivAsset}
          onOpenChange={(o) => { if (!o) setAivAsset(null); }}
          sourceImage={{ id: aivAsset.id, url: aivAsset.url, title: aivAsset.title }}
        />
      )}

      {v2vAsset && (
        <VideoToVideoDialog
          open={!!v2vAsset}
          onOpenChange={(o) => { if (!o) setV2vAsset(null); }}
          sourceImage={{ id: v2vAsset.id, url: v2vAsset.url, title: v2vAsset.title }}
          onSubmitted={() => setV2vAsset(null)}
        />
      )}

      {/* Failed asset dialog */}
      {failedAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setFailedAsset(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="font-display text-base">Generation failed</p>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {failedAsset.error_message ?? "Something went wrong."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFailedAsset(null)}
                className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  const a = failedAsset;
                  setFailedAsset(null);
                  await deleteAsset(a);
                }}
                className="rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive hover:bg-destructive/25"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <DownloadAllProgress
        progress={downloadAll.progress}
        onCancel={downloadAll.cancel}
        onDismiss={downloadAll.dismiss}
      />
    </main>
  );
}

function SheetButton({
  icon, label, onClick, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition active:scale-[0.98] " +
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
