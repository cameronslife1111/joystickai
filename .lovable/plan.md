## Problem

On the Media Gallery page, tapping + and choosing a file does nothing — no upload progress, no toast, no row in the database, no file in storage. Verified:

- `media_assets` table has 0 rows
- `joystick-media` storage bucket has 0 objects
- Bucket is public, no size limit, no MIME restriction
- Storage RLS policies look correct (user folder = `auth.uid()`)

So the upload is failing silently before it reaches the server, or it's throwing an error that isn't being surfaced clearly.

## Plan

1. **Add diagnostic visibility to the upload flow** in `src/routes/_authenticated/media.tsx` so we can see exactly where it breaks:
   - `console.log` at the start of `handleFilesPicked` with the file count + first file's name/type/size
   - `console.log` after `supabase.auth.getUser()` to confirm a session exists
   - `console.log` before/after `supabase.storage.from(BUCKET).upload(...)` with the path
   - `console.log` of the full error object (not just `e.message`) if anything throws
   - Show an info toast immediately on file pick (`"Uploading N file(s)…"`) so the user gets feedback even if the async work fails

2. **Harden the file picker path** in case the picker itself isn't firing:
   - Move the hidden `<input type="file">` reset (`fileInputRef.current.value = ""`) to run **before** the async handler so re-picking the same file works
   - Add an `onClick` log on the + button to confirm the click handler runs
   - Confirm `accept="image/*,video/*,audio/*"` isn't excluding the user's file (e.g. HEIC may report empty `file.type`); fall back to inferring kind from extension when `file.type` is empty

3. **Verify in the live preview** by:
   - Opening `/media`, tapping +, picking a small image
   - Reading the browser console + network requests to identify the actual failure point (auth, storage upload, or DB insert)

4. **Apply the targeted fix** based on what step 3 reveals — most likely one of:
   - Empty `file.type` → `detectKind` returns null → silent skip (fixed by extension fallback)
   - Storage upload 4xx (RLS / path) → fix the path or policy
   - DB insert RLS failure → fix policy or payload

5. **Remove the diagnostic logs** once the root cause is fixed, keep the user-facing toast and the extension fallback.

## Technical details

Files touched: `src/routes/_authenticated/media.tsx` only. No schema changes expected unless step 3 reveals an RLS issue, in which case a small migration on `storage.objects` or `media_assets` policies will be added.
