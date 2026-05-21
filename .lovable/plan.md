# Download All — Media Gallery

Add a download button next to the existing **+** button in the Media Gallery header that bundles every completed asset (images, videos, audio) in the current view into a single archive.

## UX

- **Placement**: New round icon button to the **left** of the `+` button in the header. Uses the `Download` lucide icon (already imported). Matches the size/shape of sibling buttons.
- **Respects the active filter chip** (All / Images / Videos / Audio). "Download All" downloads whatever is currently visible — so the user can grab just videos, just audio, etc. Button label tooltip reflects this ("Download all images", "Download all", …).
- **Disabled** when the gallery is empty or only contains `generating` / `failed` assets.
- **Progress UX**: Clicking opens a small non-blocking progress sheet showing `Zipping 12 / 47 — 38 MB`. Has a Cancel button. A toast confirms when the file lands.
- **Filename**: `orby-media-YYYY-MM-DD.zip` (or `orby-images-…`, etc., based on the filter).
- **Filename collisions inside the zip**: prefix with kind folder (`images/`, `videos/`, `audio/`) and append a short id suffix on duplicates.

## How it works

Client-side bundling — no server round-trip, no extra storage cost, works against the public asset URLs already in `media_assets.url`.

### Desktop (primary path) — streaming zip, no memory spike

1. Use **`client-zip`** (tiny, pure-Web-Streams, ~3 KB) to build a `ReadableStream` zip on the fly.
2. Pipe that stream into the **File System Access API** (`window.showSaveFilePicker`) when available (Chrome, Edge, Arc, Brave on desktop). The user picks the location once; bytes stream directly to disk — works for multi-GB galleries without holding anything in RAM.
3. Fallback for desktop Firefox/Safari (no FS Access): use **StreamSaver.js** with the same `client-zip` stream — pipes via a service worker to a normal browser download. Still no full-buffer in memory.

### iPhone / iOS Safari (fallback path)

iOS Safari doesn't support FS Access API and StreamSaver is unreliable there. Strategy:

- If total estimated size **≤ 200 MB** (read `size_bytes` from `media_assets`): build the zip in memory with `client-zip` → `Blob` → trigger a normal `<a download>` click. iOS Safari will save it to Files.
- If **> 200 MB**: warn the user and offer **chunked zips** — `orby-media-part-1-of-3.zip`, etc., each capped at ~150 MB. Each part is downloaded sequentially with a confirmation tap between parts (iOS requires a user gesture per download).
- Single-file shortcut: if filter yields exactly one asset, skip zipping and trigger a direct download of the original URL.

### Fetch concurrency

- Fetch source files with concurrency capped at **6** to stay friendly to Supabase Storage and mobile networks.
- Use `AbortController` so Cancel actually stops in-flight fetches.
- If a single asset 404s, skip it, log it, and include a `_skipped.txt` manifest in the zip listing what was missing — never abort the whole archive on one bad file.

## Technical details

**New dependency**

- `client-zip` (MIT, ~3 KB, Web-Streams native, works in Workers).
- `streamsaver` only loaded dynamically on the Firefox/Safari-desktop fallback branch so it doesn't bloat the main bundle.

**New files**

- `src/lib/download-archive.ts` — pure helper:
  - `pickArchiveStrategy({ isIOS, hasFSAccess, totalBytes })` → `"fs-access" | "stream-saver" | "blob" | "chunked-blob"`.
  - `downloadAllAssets(assets, { onProgress, signal, filename })` — orchestrates fetch + zip + save per strategy.
  - `chunkAssetsBySize(assets, maxBytes)` for the iOS large-gallery case.
- `src/components/DownloadAllProgress.tsx` — bottom sheet with progress bar, current filename, totals, Cancel.
- `src/hooks/use-download-all.ts` — manages state (`idle | preparing | zipping | done | error | cancelled`), wires `AbortController`, exposes `start()` / `cancel()`.

**Edits**

- `src/routes/_authenticated/media.tsx`:
  - Add the new header button left of `+`.
  - Wire it to `useDownloadAll`, passing the currently-filtered, `status === 'completed'` assets.
  - Mount `<DownloadAllProgress />`.

**No backend changes.** Supabase Storage URLs are already public for this bucket (used by `<img>` / `<video>` today), so direct `fetch()` works with no CORS or signed-URL juggling.

## Edge cases handled

- Empty gallery → button disabled.
- All currently-visible assets are still `generating` → button disabled with tooltip "Wait for generation to finish".
- User navigates away mid-zip → `AbortController` fires on unmount.
- Same title twice → de-duplicated with id suffix.
- Asset missing extension → inferred from `mime_type`, fallback to `.bin`.

## Out of scope

- Server-side zipping (would cost egress twice, slow, and worker memory limited).
- Selecting specific assets to download (could be a follow-up: checkbox multi-select mode).
- Resumable downloads after a browser crash.
