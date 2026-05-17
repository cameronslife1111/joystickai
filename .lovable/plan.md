## Goal

When the user swipes right on the orb to cycle favorites, the loaded sentence must always be read by web speech — including slot 1, including the wrap-around back to slot 1, and including the case where the cycle target happens to be the doc the user is already on.

## Root cause

In `onSwipeRight` (src/routes/_authenticated/app.tsx, lines 244–298):

1. `favIdxRef` is initialised to `-1`. On the **first** swipe right after mount, `filled.findIndex(s => s.i > -1)` always picks the first filled slot (slot 1). If the user is already viewing slot 1's doc, no visible change occurs and the speech often does not fire — partly perceptual, partly because Chrome/Safari can drop the autoplay-gesture chain across the two `await` round-trips before `speak()` is finally called.
2. `speak()` runs inside a `setTimeout(0)` after `window.speechSynthesis.cancel()`. When the target doc equals the active doc, the cancel + re-queue can race and swallow the new utterance.
3. There is no fallback path: if `row?.content` is missing for any reason (no sentence at that index, fetch failure), nothing is spoken at all.

## Fix

### Step 1 — Seed `favIdxRef` from the active doc

On mount and whenever `favorites` / `activeDocId` change, if `activeDocId` matches one of the filled favorite slots, set `favIdxRef.current` to that slot's index. This way the first swipe right always advances to the **next** filled slot, not the slot the user is already on. Slot 1 then gets reached naturally (either by forward traversal or wrap-around) with a real doc switch behind it.

Implementation: a small `useEffect([favorites, activeDocId])` that walks `favorites` to find a match and updates the ref. No render coupling.

### Step 2 — Make TTS unconditional on cycle

In `onSwipeRight`:

- Capture the resolved sentence text into a local `textToSpeak` variable.
- If `row?.content` is empty/missing, fall back to the target doc's title (e.g. `"<title>"` or `"Empty list"`) so the user always hears feedback that the cycle landed.
- Always call `speak(textToSpeak, token)` at the end of the handler — never gate it behind `if (row?.content)`.

### Step 3 — Harden `speak()` against same-doc replays

Currently `speak()` always calls `cancel()` then `setTimeout(0)`. When the target is the same doc and the same sentence, the cancel→queue race is most likely to swallow the utterance. Change `speak()` so that:

- It still cancels + defers via `setTimeout`, but bumps the defer to a small non-zero delay (e.g. 30ms) when an utterance was just cancelled. This matches the existing 100ms-class delays already used elsewhere in the file and gives WebKit/Blink time to flush before the new utterance is queued.
- The token check inside the timeout stays the same, so rapid successive swipes still cancel cleanly.

### Step 4 — Verify

Manual test in the preview:
1. Fill slots 1, 2, 3 with three different docs.
2. Reload the page. The active doc is slot 1's doc.
3. Swipe right → should switch to slot 2's doc AND speak slot 2's current sentence.
4. Swipe right → slot 3 spoken.
5. Swipe right → wraps to slot 1 AND speaks slot 1's current sentence.
6. Repeat from any starting doc (including a non-favorited doc) to confirm slot 1 always speaks when reached.

Also confirm rapid swipe-right-right-right still ends with only the final slot's sentence playing (no overlap), proving the token gate is intact.

## Files touched

- `src/routes/_authenticated/app.tsx` — add the `useEffect` to seed `favIdxRef`, simplify the end of `onSwipeRight` to always speak, and adjust the `setTimeout` delay inside `speak()`.

No DB changes, no new dependencies, no gesture-map changes.
