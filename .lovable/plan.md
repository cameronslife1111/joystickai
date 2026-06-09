## What's actually broken

Earlier we fixed cellular loading by intercepting `window.fetch` and rerouting backend requests through a same-origin proxy (`/api/public/sb/...`). That fix works for **data** (database queries go through `fetch`).

But the media gallery displays files using native `<img>`, `<video>`, and `<audio>` tags pointing directly at the backend storage host (`*.supabase.co`). **Native element loads do NOT go through `window.fetch`**, so the proxy never touches them. On cellular, the carrier breaks those direct browser→backend connections — which is exactly why the gallery only loads when Wi-Fi is on, while the rest of the app works fine.

## The fix (small, surgical, same proven mechanism)

Reuse the exact same rewrite the fetch proxy already uses, but apply it to media element `src` URLs so they also travel over the same-origin path that works on cellular.

### 1. Export a tiny helper from the existing proxy file

In `src/lib/sb-proxy.client.ts`, export a pure function (same logic already used internally):

```text
proxyMediaUrl(url):
  if no url or no BACKEND_URL or not on client → return url unchanged
  if url does not start with BACKEND_URL → return url unchanged   (already same-origin or external)
  else → rewrite to `${origin}/api/public/sb/${rest}`
```

This is SSR-safe (returns the original URL on the server, so server-rendered markup stays valid) and a no-op for any URL that isn't a backend URL — zero risk to non-backend images.

### 2. Apply it to every media `src`

Wrap the `src` of media elements with `proxyMediaUrl(...)` in:

- `src/routes/_authenticated/media.tsx` — grid thumbnails (img + video) and the fullscreen viewer (img/video/audio)
- `src/components/MediaGalleryPicker.tsx` — picker thumbnails (img + video)
- `src/components/ImageToVideoDialog.tsx`, `AudioImageToVideoDialog.tsx`, `VideoToVideoDialog.tsx`, `RemixImagesDialog.tsx`, `RegenerateImageDialog.tsx` — source/preview thumbnails

No data shape changes: the stored `url` in the database stays exactly as-is. We only transform it at render time for display.

### Why this is safe

- The `/api/public/sb/$` proxy already forwards arbitrary backend paths, including public storage objects, preserving Range headers (so video scrubbing keeps working) and status codes.
- The helper is a strict no-op unless the URL begins with the backend host, so external images, data URLs, and blob URLs pass through untouched.
- Downloads already use `fetch(asset.url)` which is intercepted by the existing proxy, so they're unaffected.
- No backend, schema, RLS, or business-logic changes — purely presentation-layer URL rewriting.

### Verification

After the change, load the media gallery in the preview to confirm thumbnails and the fullscreen viewer render, and that video playback/scrubbing still works.
