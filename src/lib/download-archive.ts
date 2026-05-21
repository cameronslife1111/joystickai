// Client-side archive builder for the Media Gallery.
//
// Strategies:
//   - "fs-access":      Chrome/Edge/Arc desktop. Streams zip to disk via
//                        showSaveFilePicker. No memory cap.
//   - "stream-saver":   Desktop Firefox/Safari. Streams zip via a service
//                        worker shim. No memory cap.
//   - "blob":           iOS Safari and other fallbacks. Buffers in memory,
//                        then triggers an <a download> click.
//   - "chunked-blob":   iOS path when totalBytes > MAX_BLOB_BYTES. Splits
//                        assets into ~150 MB parts; user gesture per part.

import { downloadZip } from "client-zip";

export type ArchivableAsset = {
  id: string;
  title: string;
  kind: "image" | "video" | "audio";
  url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
};

export type ArchiveStrategy = "fs-access" | "stream-saver" | "blob" | "chunked-blob";

export type ArchiveProgress = {
  phase: "preparing" | "zipping" | "saving" | "done" | "cancelled" | "error";
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  currentFile?: string;
  currentPart?: number;
  totalParts?: number;
  error?: string;
};

const MAX_BLOB_BYTES = 200 * 1024 * 1024;   // 200 MB cap for single in-memory zip
const PART_BYTES = 150 * 1024 * 1024;       // ~150 MB per chunk
const FETCH_CONCURRENCY = 6;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif", "image/heic": "heic", "image/heif": "heif",
  "image/svg+xml": "svg", "image/bmp": "bmp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/flac": "flac",
  "audio/opus": "opus", "audio/webm": "weba",
};

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iPadOS 13+ reports as Mac; check touch points.
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Mac") && (navigator as any).maxTouchPoints > 1);
}

export function hasFSAccess(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";
}

export function pickArchiveStrategy(opts: { totalBytes: number }): ArchiveStrategy {
  const ios = isIOS();
  if (ios) {
    return opts.totalBytes > MAX_BLOB_BYTES ? "chunked-blob" : "blob";
  }
  if (hasFSAccess()) return "fs-access";
  return "stream-saver";
}

function extFor(asset: ArchivableAsset): string {
  if (asset.mime_type && EXT_BY_MIME[asset.mime_type]) return EXT_BY_MIME[asset.mime_type];
  if (asset.url) {
    const m = asset.url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase();
  }
  return "bin";
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

function buildEntryName(asset: ArchivableAsset, used: Set<string>): string {
  const folder = asset.kind === "image" ? "images/" : asset.kind === "video" ? "videos/" : "audio/";
  const base = safeName(asset.title);
  const ext = extFor(asset);
  let name = `${folder}${base}.${ext}`;
  if (used.has(name)) {
    name = `${folder}${base}-${asset.id.slice(0, 6)}.${ext}`;
  }
  used.add(name);
  return name;
}

export function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function defaultZipName(filterLabel: string): string {
  return `orby-${filterLabel}-${todayStamp()}.zip`;
}

type FetchedEntry = { name: string; input: Blob; lastModified: Date };

async function fetchOne(
  asset: ArchivableAsset,
  name: string,
  signal: AbortSignal,
): Promise<FetchedEntry | null> {
  if (!asset.url) return null;
  const res = await fetch(asset.url, { signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  return { name, input: blob, lastModified: new Date() };
}

async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function streamToWritable(
  stream: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  onChunk: (n: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const writer = writable.getWriter();
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      onChunk(value.byteLength);
      await writer.write(value);
    }
    await writer.close();
  } catch (err) {
    try { await writer.abort(err); } catch { /* noop */ }
    throw err;
  } finally {
    reader.releaseLock();
  }
}

function chunkAssetsBySize(assets: ArchivableAsset[], maxBytes: number): ArchivableAsset[][] {
  const parts: ArchivableAsset[][] = [];
  let current: ArchivableAsset[] = [];
  let currentBytes = 0;
  for (const a of assets) {
    const size = a.size_bytes ?? 0;
    if (current.length > 0 && currentBytes + size > maxBytes) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(a);
    currentBytes += size;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

async function buildZipBlob(
  assets: ArchivableAsset[],
  signal: AbortSignal,
  onProgress: (p: Partial<ArchiveProgress>) => void,
  fileOffset = 0,
  totalFiles?: number,
): Promise<Blob> {
  const used = new Set<string>();
  const skipped: string[] = [];
  const entries: FetchedEntry[] = [];
  const total = totalFiles ?? assets.length;
  let done = fileOffset;

  await mapWithConcurrency(assets, FETCH_CONCURRENCY, async (a) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const name = buildEntryName(a, used);
    onProgress({ currentFile: a.title });
    try {
      const entry = await fetchOne(a, name, signal);
      if (entry) entries.push(entry);
      else skipped.push(`${name} (no url or fetch failed)`);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      skipped.push(`${name} (${(err as Error)?.message ?? "error"})`);
    } finally {
      done++;
      onProgress({ filesDone: done });
    }
  });

  if (skipped.length > 0) {
    entries.push({
      name: "_skipped.txt",
      input: new Blob([skipped.join("\n")], { type: "text/plain" }),
      lastModified: new Date(),
    });
  }

  const resp = downloadZip(entries);
  return await resp.blob();
}

export async function downloadAllAssets(
  assets: ArchivableAsset[],
  opts: {
    filterLabel: string;
    signal: AbortSignal;
    onProgress: (p: ArchiveProgress) => void;
  },
): Promise<void> {
  const { signal, onProgress, filterLabel } = opts;
  const filtered = assets.filter((a) => !!a.url);
  if (filtered.length === 0) {
    onProgress({
      phase: "error", filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0,
      error: "No downloadable assets",
    });
    return;
  }

  if (filtered.length === 1) {
    const only = filtered[0];
    onProgress({
      phase: "saving", filesDone: 0, filesTotal: 1, bytesDone: 0,
      bytesTotal: only.size_bytes ?? 0, currentFile: only.title,
    });
    try {
      const res = await fetch(only.url!, { signal });
      const blob = await res.blob();
      triggerBlobDownload(blob, `${safeName(only.title)}.${extFor(only)}`);
      onProgress({
        phase: "done", filesDone: 1, filesTotal: 1,
        bytesDone: blob.size, bytesTotal: blob.size,
      });
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      onProgress({
        phase: aborted ? "cancelled" : "error",
        filesDone: 0, filesTotal: 1, bytesDone: 0, bytesTotal: 0,
        error: aborted ? undefined : ((err as Error)?.message ?? "Download failed"),
      });
    }
    return;
  }

  const bytesTotal = filtered.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0);
  const strategy = pickArchiveStrategy({ totalBytes: bytesTotal });
  const baseName = defaultZipName(filterLabel);

  const progress: ArchiveProgress = {
    phase: "preparing", filesDone: 0, filesTotal: filtered.length,
    bytesDone: 0, bytesTotal,
  };
  onProgress({ ...progress });

  try {
    if (strategy === "fs-access") {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: baseName,
        types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
      });
      const writable: WritableStream<Uint8Array> = await handle.createWritable();
      await streamWithClientZip(filtered, writable, progress, onProgress, signal);
      onProgress({ ...progress, phase: "done" });
      return;
    }

    if (strategy === "stream-saver") {
      try {
        const mod: any = await import("streamsaver");
        const streamSaver = mod.default ?? mod;
        streamSaver.mitm = "https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0";
        const fileStream = streamSaver.createWriteStream(baseName);
        await streamWithClientZip(filtered, fileStream, progress, onProgress, signal);
        onProgress({ ...progress, phase: "done" });
        return;
      } catch {
      }
    }

    if (strategy === "chunked-blob") {
      const parts = chunkAssetsBySize(filtered, PART_BYTES);
      let fileOffset = 0;
      for (let i = 0; i < parts.length; i++) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const partName = baseName.replace(/\.zip$/, `-part-${i + 1}-of-${parts.length}.zip`);
        onProgress({
          ...progress, phase: "zipping",
          currentPart: i + 1, totalParts: parts.length,
        });
        const blob = await buildZipBlob(parts[i], signal, (p) => {
          Object.assign(progress, p);
          onProgress({ ...progress, phase: "zipping", currentPart: i + 1, totalParts: parts.length });
        }, fileOffset, filtered.length);
        fileOffset += parts[i].length;
        triggerBlobDownload(blob, partName);
        await new Promise((r) => setTimeout(r, 800));
      }
      onProgress({ ...progress, phase: "done", filesDone: filtered.length });
      return;
    }

    onProgress({ ...progress, phase: "zipping" });
    const blob = await buildZipBlob(filtered, signal, (p) => {
      Object.assign(progress, p);
      onProgress({ ...progress, phase: "zipping" });
    });
    triggerBlobDownload(blob, baseName);
    onProgress({ ...progress, phase: "done", filesDone: filtered.length });
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    onProgress({
      ...progress,
      phase: aborted ? "cancelled" : "error",
      error: aborted ? undefined : ((err as Error)?.message ?? "Download failed"),
    });
  }
}

async function streamWithClientZip(
  assets: ArchivableAsset[],
  writable: WritableStream<Uint8Array>,
  progress: ArchiveProgress,
  onProgress: (p: ArchiveProgress) => void,
  signal: AbortSignal,
) {
  const used = new Set<string>();
  const skipped: string[] = [];
  let done = 0;

  async function* source(): AsyncGenerator<{ name: string; input: ReadableStream<Uint8Array> | Blob; lastModified: Date }> {
    for (const a of assets) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const name = buildEntryName(a, used);
      progress.currentFile = a.title;
      onProgress({ ...progress, phase: "zipping" });
      try {
        if (!a.url) { skipped.push(`${name} (no url)`); continue; }
        const res = await fetch(a.url, { signal });
        if (!res.ok || !res.body) { skipped.push(`${name} (http ${res.status})`); continue; }
        yield { name, input: res.body, lastModified: new Date() };
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        skipped.push(`${name} (${(err as Error)?.message ?? "error"})`);
      } finally {
        done++;
        progress.filesDone = done;
        onProgress({ ...progress, phase: "zipping" });
      }
    }
    if (skipped.length > 0) {
      yield {
        name: "_skipped.txt",
        input: new Blob([skipped.join("\n")], { type: "text/plain" }),
        lastModified: new Date(),
      };
    }
  }

  const zipResp = downloadZip(source());
  if (!zipResp.body) throw new Error("client-zip produced no body");
  await streamToWritable(
    zipResp.body,
    writable,
    (n) => {
      progress.bytesDone += n;
      onProgress({ ...progress, phase: "zipping" });
    },
    signal,
  );
}
