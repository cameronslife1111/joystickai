import { X } from "lucide-react";
import type { ArchiveProgress } from "@/lib/download-archive";

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function phraseFor(p: ArchiveProgress): string {
  switch (p.phase) {
    case "preparing": return "Preparing…";
    case "zipping":
      if (p.totalParts && p.totalParts > 1) {
        return `Zipping part ${p.currentPart} of ${p.totalParts}`;
      }
      return "Zipping";
    case "saving": return "Saving…";
    case "done": return "Done";
    case "cancelled": return "Cancelled";
    case "error": return p.error ?? "Failed";
  }
}

interface Props {
  progress: ArchiveProgress | null;
  onCancel: () => void;
  onDismiss: () => void;
}

export function DownloadAllProgress({ progress, onCancel, onDismiss }: Props) {
  if (!progress) return null;
  const terminal = progress.phase === "done"
    || progress.phase === "error"
    || progress.phase === "cancelled";
  const pct = progress.bytesTotal > 0
    ? Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100)
    : progress.filesTotal > 0
      ? (progress.filesDone / progress.filesTotal) * 100
      : 0;

  return (
    <div
      className="fixed inset-x-0 z-40 px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
    >
      <div className="mx-auto w-full max-w-md rounded-2xl border border-foreground/10 bg-background/95 p-4 shadow-lg backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-sm">{phraseFor(progress)}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {progress.filesDone} / {progress.filesTotal} files
              {progress.bytesTotal > 0
                ? ` · ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
                : ""}
              {progress.currentFile && progress.phase === "zipping"
                ? ` · ${progress.currentFile}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={terminal ? onDismiss : onCancel}
            aria-label={terminal ? "Dismiss" : "Cancel download"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/10 transition active:scale-95 hover:bg-foreground/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
