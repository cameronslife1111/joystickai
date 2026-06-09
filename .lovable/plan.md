## What's going wrong

Earlier we fixed "text won't load on cellular" by adding a fetch interceptor (`src/lib/sb-proxy.client.ts`) that reroutes backend calls through a same-origin proxy (`/api/public/sb/$`). That works for data calls because they go through `window.fetch`.

But the **Media Gallery shows images and videos using HTML `<img src>` / `<video src>` elements** pointing straight at the backend storage host. Those element loads do **not** go through `window.fetch`, so they are **not** rerouted. On the same flaky/cellular networks that broke text before, these direct media connections fail — so the gallery loads its layout but the thumbnails/videos never appear. Data (text) loads; media doesn't. That's the new bug.

## The fix

Send media file loads through the exact same same-origin proxy the data already uses, so everything travels over the one connection that works on every network.

### 1. Add a URL rewrite helper
In `src/lib/sb-proxy.client.ts`, export a small `toProxiedMediaUrl(url)`:
- On the client, if the URL points at the backend host (`VITE_SUPABASE_URL`), rewrite it to `${window.location.origin}/api/public/sb/<rest>`.
- Otherwise (external provider URLs, server-side rendering, empty values) return it unchanged.

This mirrors the existing `rewriteUrl` logic already in that file.

### 2. Use it for every media element source (display only)
Wrap `a.url` / `currentAsset.url` with the helper wherever it feeds an `<img>`, `<video>`, `<audio>`, or `poster`:
- `src/routes/_authenticated/media.tsx` — grid thumbnails (image + video) and the full-screen viewer (image, video, audio).
- `src/components/MediaGalleryPicker.tsx` — picker thumbnails.
- Preview thumbnails in `RegenerateImageDialog.tsx`, `RemixImagesDialog.tsx`, `ImageToVideoDialog.tsx`, `VideoToVideoDialog.tsx`.

**Important:** only the *displayed* URLs get rewritten. URLs passed to backend functions (`image_url`, `video_url`, `audio_url`, download, regenerate inputs) keep the original backend URL so the server can still fetch them. The `handleDownload` path already routes through the fetch interceptor, so it stays as-is.

### 3. Make the proxy stream media efficiently
Currently the proxy buffers the entire response into memory (`arrayBuffer`). That's fine for small JSON but wasteful/risky for images and especially videos. Update `src/routes/api/public/sb/$.ts` to:
- Stream the upstream body through (`upstream.body`) instead of buffering.
- Preserve `Range` request headers and `Content-Range`/`Accept-Ranges`/`206` responses so video seeking and partial loads work.

### 4. Verify
- Confirm the dev server is healthy (there are some stale SSR error lines in the log from when the proxy file was first added) and the build passes.
- Load the gallery and confirm thumbnails, the full-screen viewer, and video playback all render via the same-origin proxy path.

## Outcome
Images, videos, and audio load through the same reliable same-origin path as text, so the Media Gallery and everything else loads on Wi-Fi, 4G, and 5G alike — clean UI, mobile-optimized, no behavior changes.

## Technical notes
- The storage bucket is public (`getPublicUrl`), so proxied media GETs need no auth — the proxy forwards them as-is.
- Streaming the body avoids holding large videos in worker memory and keeps range requests working.
- No database or schema changes.