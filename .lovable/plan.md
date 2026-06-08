# Fix lock (slot 22): persist & restore the locked list

## Problem
When the user locks a list (slot 22), reloading the site does not return to the locked document — it falls back to the last favorite slot or the first doc. Lock is stored only as a boolean (`lock_favorites`); the specific locked document is never remembered, so restore can't target it.

## Goal
- When locked, a reload returns to the exact list the user was locked on, and stays locked.
- While locked, the only way to reach another document is following a linked step (swipe right). Linked documents can chain (follow further links first); when a step has no further link, swipe right returns to the locked list. All other jumps (favorites cycling, pinned doc) stay blocked.

## Changes

### 1. Database (migration)
Add a column to `user_preferences`:
- `locked_document_id uuid` (nullable) — the document the user is locked onto.

No new table, so existing grants/RLS already cover it.

### 2. Persist the locked doc (`src/routes/_authenticated/app.tsx`)
- Extend the `user_preferences` query select + return type to include `locked_document_id`, and expose `lockedDocId = prefs?.locked_document_id ?? null`.
- Add a `saveLockedDoc(docId: string | null)` helper (mirrors `savePinnedDoc`) that upserts `locked_document_id`.
- In the lock toggle handler (the slot-22 menu action, ~line 1613): when turning lock **on**, also save `locked_document_id = activeDocId`; when turning **off**, save `locked_document_id = null`.

### 3. Restore on reload (the effect at ~line 377)
Before the existing last-favorite-slot logic: if `prefs.lock_favorites` is true and `locked_document_id` exists in `docs`, `setActiveDocId(lockedDocId)` and return. Otherwise keep the current behavior unchanged.

### 4. Swipe-right while locked (`onSwipeRight`, ~line 804)
Keep "follow further links first":
- If the current sentence has a valid `linked_document_id` → open it (existing behavior, works for chained links).
- Else if locked **and** the active doc is not the locked doc → return to the locked document (load it at its saved sentence, same fetch/prime pattern as `openLinkedDocument`).
- Else if locked (on the locked doc, no link) → repeat the current sentence (existing behavior).
- Unlocked behavior is unchanged.

This guarantees that while locked the user can only leave the locked list by following links, and always lands back on the locked list when the chain ends.

## Technical notes
- Restore depends on `docs` being loaded, so the membership check (`docs.some(d => d.id === lockedDocId)`) avoids pointing at a deleted doc; falls back to existing logic if missing.
- Returning to the locked doc reuses the existing parallel fetch + `qc.setQueryData` priming used by `openLinkedDocument`/`onSwipeRight` to keep display and speech in sync.
- No change to unlocked flows, favorites cycling, or pinned-doc behavior.
