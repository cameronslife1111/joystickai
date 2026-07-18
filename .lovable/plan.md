## Problem

Right now each document's icon loads lazily: when you swipe to a new doc, we (1) run a per-document query against `document_icons` to find the URL, then (2) the browser starts downloading the image. That's a two-step waterfall on every first visit to a doc, which is exactly the "little glitch on the first swipe, fast afterward" you're seeing (afterward it's cached).

Root cause in `src/routes/_authenticated/app.tsx` (lines 287–301): the `["document_icon", activeDocId]` query is keyed per active doc, so it can't answer until you've already switched.

## Fix

Two small, low-risk changes — no schema changes, no visual changes, gestures untouched.

### 1. One query for all icons, look up synchronously

Replace the per-doc query with a single global query that fetches the full `{ document_id → icon url }` map once (and revalidates when assignments change). Deriving `docIconUrl` from that map is synchronous, so the moment `activeDocId` changes the correct URL is already known — no fetch on swipe.

- New query: `["document_icons_map"]` selecting `document_id, media_assets(url)` from `document_icons` for the current user. Small table (one row per doc that has an icon), fine to load whole.
- `docIconUrl = iconMap.get(activeDocId) ?? null`.
- Update `AssignDocumentIconDialog`'s post-save invalidation to invalidate `["document_icons_map"]` instead of `["document_icon"]`.

### 2. Preload the image bytes for current + neighbors

Even with the URL known synchronously, the `<img>` still has to download on first view. Add a tiny effect that calls `new Image().src = proxyMediaUrl(url)` for:
- the current doc's icon,
- the next doc's icon (right swipe),
- the previous doc's icon (left swipe).

That way the neighbor images are already in the browser's HTTP cache before you swipe, so the `<img>` in `DocumentIconAvatar` paints from cache immediately. Runs off the same `iconMap` + docs list already in memory; no extra network on hot paths.

### Files touched

- `src/routes/_authenticated/app.tsx` — swap the per-doc query for the map query; derive `docIconUrl`; add the neighbor-preload effect.
- `src/components/AssignDocumentIconDialog.tsx` — invalidate the new `["document_icons_map"]` key after save.

### Not changing

- No resizing / thumbnail pipeline (would require storage transforms we don't have set up, and the images are already reasonable). If lag ever remains after this, we can revisit adding a `?width=` transform through the proxy as a separate task.
- `DocumentIconAvatar` and orb gestures are untouched.
- `proxyMediaUrl` behavior is untouched.
