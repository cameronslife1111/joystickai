## Goal

Rework the orb gestures and add a "New idea" composer with a Send To target picker.

## New gesture map

| Gesture | Action |
|---|---|
| Single tap | Open **New idea** composer (blank textarea + Send To / Cancel buttons) |
| Double tap | Edit current sentence (unchanged) |
| Triple tap | Delete current sentence (was swipe-down) |
| Swipe up | Previous sentence (unchanged) |
| Swipe down | **Next sentence** (was single tap) |
| Swipe left | Open menu (unchanged) |
| Swipe right | Cycle favorites (unchanged) |
| Long press | Voice (unchanged) |

## Step 1 — Triple-tap support in `use-orb-gestures.ts`

Replace the "tap vs double-tap" block with a tap-count state machine:

- Track `tapCount` and a single `tapTimer` (window = `doubleTapMs`, default 280ms).
- On each qualifying pointer-up (no swipe, no long-press): increment `tapCount`, clear the existing timer, start a new one.
- When the timer fires:
  - `tapCount === 1` → `onTap`
  - `tapCount === 2` → `onDoubleTap`
  - `tapCount >= 3` → `onTripleTap`
  - reset.
- Add `onTripleTap?: () => void` to `OrbGestureCallbacks`.

Trade-off: single tap now fires ~280ms after release (it already did, to wait for a possible double). No regression — single tap goes from "next sentence" to "open composer", so the small delay is invisible.

## Step 2 — Rewire `app.tsx` gesture handlers

In `useOrbGestures({...})`:
- `onTap` → `openNewIdea()` (was advance-sentence).
- `onDoubleTap` → unchanged.
- `onTripleTap` → existing delete logic (move the body of `onSwipeDown` into a new `deleteCurrent` callback; call it from both, but `onSwipeDown` now calls `advanceSentence` instead).
- `onSwipe`: `down` → `advanceSentence` (extract current `onTap` body), `up`/`left`/`right` unchanged.

Rename internally for clarity:
- `onTap` (advance) → `advanceSentence`
- `onSwipeDown` (delete) → `deleteCurrent`

## Step 3 — "New idea" composer

Add component state: `composing: boolean`, `composeText: string`.

Render rules in the sentence area:
- If `composing` → show a textarea identical to the edit textarea (auto-focus, caret at end, same styling).
- Header label flips from doc title to **"New idea"** while `composing` is true (small badge or replace text — keep doc title visible too: e.g. `New idea · {title}`).
- Below the orb (absolutely positioned above it, `bottom: orbTop + gap`), render two glowing pill buttons: **Cancel** and **Send to…**.
  - Cancel → clears state, returns to normal view.
  - Send to → opens the target picker modal (Step 4).
- Enter (no shift) in the textarea opens the picker the same as clicking Send to. Escape cancels.

Styling: reuse existing button styles, add a soft glow via `box-shadow` using `--aurora-2` / primary token, no new hex colors.

## Step 4 — Send-to picker

A modal (same overlay pattern as the existing Jump / Favorites modals) with two stages:

1. **Pick document** — list all docs (`docs` query), tap one to advance.
2. **Pick position** — three buttons: `Top`, `Bottom`, `Current`.
   - `Current` is disabled if the chosen doc has no sentences (fall back to Top).

On confirm, run `sendIdea(targetDocId, position)`:

- Split `composeText` via existing `splitIntoSentences` (handles multi-sentence input gracefully).
- Load target doc's sentences (`supabase.from("sentences").select(...).eq("document_id", targetDocId).order("order_index")`).
- Compute `insertAt`:
  - `top` → 0
  - `bottom` → `existing.length`
  - `current` → `(targetDoc.current_sentence_index ?? 0) + 1` (if target doc === active doc, use live `currentIdx + 1`)
- Shift `order_index` of every sentence at/after `insertAt` by `parts.length` (descending loop, matches existing pattern at lines 341–345 / 389–393).
- Insert new rows with sequential `order_index` starting at `insertAt`.
- `qc.invalidateQueries(["sentences", targetDocId])`.
- Toast `"Sent to {title}"` with the existing toaster (top, replaceable id).
- Close composer + picker.

Do NOT switch the active doc when sending — user stays where they are.

## Step 5 — Edge cases

- If `composing` is true, suppress orb gestures? No — orb still works; tapping orb again does nothing visible because the textarea has focus. We keep the textarea blur from auto-committing (it's a separate code path from `commitEdit`).
- Empty `composeText` → Send to is disabled.
- No docs at all → picker shows "Create a doc first" and disables confirm.

## Files touched

- `src/hooks/use-orb-gestures.ts` — add triple-tap.
- `src/routes/_authenticated/app.tsx` — rewire gestures, add composer UI, add send-to modal, add `sendIdea` and `deleteCurrent` callbacks.

No DB schema changes. No new dependencies.
