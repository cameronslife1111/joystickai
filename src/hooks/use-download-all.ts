import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  downloadAllAssets,
  type ArchivableAsset,
  type ArchiveProgress,
} from "@/lib/download-archive";

export function useDownloadAll() {
  const [progress, setProgress] = useState<ArchiveProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const start = useCallback(async (assets: ArchivableAsset[], filterLabel: string) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({
      phase: "preparing", filesDone: 0, filesTotal: assets.length,
      bytesDone: 0, bytesTotal: assets.reduce((s, a) => s + (a.size_bytes ?? 0), 0),
    });
    await downloadAllAssets(assets, {
      filterLabel,
      signal: ctrl.signal,
      onProgress: (p) => setProgress({ ...p }),
    });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    setProgress(null);
  }, []);

  // Auto-toast and auto-dismiss on terminal states.
  useEffect(() => {
    if (!progress) return;
    if (progress.phase === "done") {
      toast.success("Download ready");
      const id = window.setTimeout(() => setProgress(null), 2500);
      return () => window.clearTimeout(id);
    }
    if (progress.phase === "cancelled") {
      const id = window.setTimeout(() => setProgress(null), 1500);
      return () => window.clearTimeout(id);
    }
    if (progress.phase === "error" && progress.error) {
      toast.error(progress.error);
    }
  }, [progress]);

  return { progress, start, cancel, dismiss };
}
