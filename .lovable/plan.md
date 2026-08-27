# Fix "signal is aborted without reason" on image upload

## What's actually happening

The error is not coming from the image or the storage bucket — it's our own network safety net cutting the upload off.

When we fixed data loading on cellular, we installed a browser-wide request interceptor (`src/lib/sb-proxy.ts`) that reroutes every backend request through the app's own origin and aborts any request that takes longer than 20 seconds. That 20-second cap was meant for small data reads, but it also applies to file uploads. A multi‑megabyte photo on a normal mobile/home upstream connection often needs longer than 20 seconds, so the interceptor calls `abort()` with no reason attached — which the browser reports verbatim as `signal is aborted without reason`, and the media screen shows it next to the filename.

Two supporting details from the code:
- Uploads are `POST`/`PUT`, so they get exactly one attempt (retries are limited to reads), meaning one slow moment fails the whole upload.
- The upload flows through the same-origin proxy route, which buffers the entire file in memory before forwarding, adding to the elapsed time.

## The fix

1. Make the timeout size-aware instead of a flat 20 seconds:
   - Keep 20 seconds for ordinary API reads/writes.
   - For requests carrying a large body (file uploads: `Blob`/`File`/`ArrayBuffer`/`FormData`), scale the allowance from the payload size with a generous floor and ceiling (roughly 60 s minimum, growing with megabytes, capped at a few minutes).
2. Abort with an explicit reason so any future timeout surfaces as a readable message ("Upload timed out — check your connection and try again") rather than "signal is aborted without reason".
3. In the media upload handler, map an abort/timeout failure to that clear, human message including the filename, so the toast tells the user what to do.
4. Let large uploads bypass the same-origin proxy rewrite when the direct backend connection is available, so a big file goes straight to storage instead of being buffered through the worker. Reads keep using the proxy exactly as today, so the cellular fix stays intact.

## Scope / technical notes

- Files touched: `src/lib/sb-proxy.ts` (timeout policy, abort reason, upload passthrough) and `src/routes/_authenticated/media.tsx` (error message only).
- No backend, schema, bucket, or RLS changes.
- No change to the cellular proxy behavior for normal API traffic.
