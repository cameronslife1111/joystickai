## Goal
Let a user pick any image from the Media Gallery, assign it to one or more documents, and have that image replace Orby (as a circular avatar) whenever those documents are active. Documents with no assigned image keep the normal Orby. All swipes, taps, gestures, and Orb state animations continue to work unchanged.

## UX

1. In the Media Gallery, open an image, tap the ⋯ options sheet.
2. New action: **"Set as document icon"** (image only, above Delete).
3. Tapping it opens a document picker sheet listing all the user's docs with checkboxes (multi-select), plus a search box. Docs already using this image are pre-checked.
4. Tap **Save** → assignments are written to the database. Toast: "Icon assigned to N document(s)".
5. On the main app screen, when the active document has an assigned image, Orby's visual is replaced by that image, rendered as a circle exactly the size/position of the current orb. Face, aurora glow, and halo are hidden; the image sits inside the circle (object-cover, centered). When the active document has no assignment, the normal animated Orb renders as today.
6. Removing the assignment: re-open "Set as document icon" and uncheck the doc, or long-press the doc icon on Orby to clear (optional — see below).

## Data model

New link table (many docs can share one image; a doc has at most one icon):

```sql
create table public.document_icons (
  document_id uuid primary key references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.document_icons (user_id);
create index on public.document_icons (media_asset_id);
-- GRANTs + RLS: authenticated can select/insert/update/delete own rows; service_role all.
```

Storing on `documents` directly would also work, but a side table keeps auto-generated `types.ts` for `documents` untouched and makes "which docs use image X" a cheap query.

## Frontend changes

- `src/routes/_authenticated/media.tsx`
  - Add a new `SheetButton` entry "Set as document icon" (icon: `ImageIcon` or `Sparkles`), only for `kind === "image"`.
  - Opens a new component `AssignDocumentIconDialog` that:
    - Fetches user's documents (reuse existing docs query pattern).
    - Fetches existing `document_icons` rows for `media_asset_id = asset.id` → pre-check them.
    - Checkbox list with a small search filter (reuse `sortDocsByTitle`, follow `DocumentPickerSheet` styling).
    - On Save: diff selected vs. initial → upsert new rows, delete unchecked rows. Uses `.upsert(..., { onConflict: 'document_id' })` so assigning image B to a doc that already has image A replaces it.

- `src/routes/_authenticated/app.tsx`
  - Add a query for the active document's icon: `document_icons` join `media_assets` where `document_id = activeDocId`, selecting `media_assets.url`.
  - In the Orb section (lines 2153–2189), when an icon URL exists render a circular `<img>` in place of the animated Orb visuals, keeping the same wrapper `<div>` and same size math. The existing invisible flanking buttons (delete / repeat) and swipe handlers on the orb element remain wired to the same element, so all gestures keep working.
  - Keep `orbRef` and gesture bindings intact by having the image sit inside a `<button ref={orbRef}>` shell that mirrors Orb's outer button (same className modifiers for listening/thinking states, so a pulse/ring still shows around the image when speaking/thinking).

- New file: `src/components/DocumentIconAvatar.tsx`
  - Renders `<button>` styled as a circle with `overflow-hidden`, `<img src={proxyMediaUrl(url)} className="w-full h-full object-cover">`, plus a soft ring that reacts to `state` prop (listening/thinking) so the user still sees activity feedback.

## Backend

- One migration creating `public.document_icons` with GRANTs + RLS as above.
- No edge function changes required.

## Out of scope

- No changes to the animated Orb component itself.
- No changes to gestures, keyboard shortcuts, chat, or planning.
- Video/audio assets are not offered as icons (image-only).

## Technical notes

- Use `proxyMediaUrl` (from `src/lib/sb-proxy.ts`) for the avatar `<img>` so cellular loading stays reliable, consistent with `MediaGalleryPicker`.
- Invalidate the icon query on assignment save and on media asset delete (the FK cascade handles DB cleanup; UI just needs a refetch).
- Preload the icon image (`<link rel="preload">` or new Image()) on document change to avoid a flash before Orby is replaced.
