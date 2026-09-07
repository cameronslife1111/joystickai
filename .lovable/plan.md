# Quick edit: saved everywhere, plus Copy and Duplicate

## What changes

1. **The "Pressing a sentence" choice follows your account.** Whichever mode you pick in the settings popup (full editor or quick edit this sentence) is saved to your account, so logging in on another phone or computer opens in the same mode. The choice still applies instantly on the device you change it on.

2. **Two new pill buttons while quick-editing a sentence**, sitting between Cancel and Done:
   - **Copy** — copies exactly what's in the box to your clipboard so you can paste it anywhere, with a short "Copied" toast. You stay in the editing box.
   - **Duplicate** — adds an identical copy of the sentence right after it, and keeps you editing the original.

3. **Done is purple.** The Done pill becomes a solid violet button so it stands out as the confirm action; Cancel, Copy and Duplicate keep the current quiet pill look.

## Technical notes

All in `src/routes/_authenticated/app.tsx`.

- **Persisting tap mode:** add `tap_mode` to the `user_preferences` select and returned shape in the prefs query (line ~507), normalised to `"editor" | "sentence"` with `null` fallback. Add a `saveTapMode` callback next to `saveTheme` that sets local state, still writes `localStorage["orby_tap_mode"]` (so first paint is right before prefs load), optimistically updates the `["user_preferences"]` cache, and upserts `{ user_id, tap_mode: next, favorites }` with `onConflict: "user_id"`. Add a hydrate effect mirroring the theme one: when `prefs?.tap_mode` arrives and differs, `setTapMode`. The settings popup button (line ~3353) calls `void saveTapMode(opt.v)`.
- **Migration:** `alter table public.user_preferences add column if not exists tap_mode text;` — existing RLS/grants on the table already cover it. Regenerate types afterwards.
- **Copy button:** reuses the existing `copyToClipboard` helper (line 850) with `quickEditText.trim()`; empty → "Nothing to copy" toast; success → `toast.success("📋 Copied")` with a fixed toast id. Does not close the box.
- **Duplicate button:** new `duplicateQuickEditSentence` callback near `commitQuickEdit` (line ~1852). Builds `contents` from `sentences`, splices `parseEditParts(quickEditText)` in at `editOriginIdxRef.current` **twice**, calls the existing `commit_document_edit` RPC, invalidates `["sentences", docId]`, keeps `quickEditing` true with the same `quickEditText`, and toasts "📄 Duplicated". Errors reuse the "Couldn't save edits" toast. No speech (we stay in the box).
- **Button row** (line ~2974): four pills, `flex-wrap justify-center gap-2` so they fit at 390px. Done becomes `bg-aurora-2 text-background hover:bg-aurora-2/90` (the existing violet token) with no border; the others keep the current classes.

## Verification

Typecheck plus the build log, then in the preview: switch to quick edit mode, reload and confirm it stuck; open a sentence, press Copy (toast, text still there), press Duplicate (two identical sentences, still editing), and check Done is purple and still saves and reads back.
