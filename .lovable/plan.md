## Replace current slot

Add a new action to the "Send to" popup that swaps the user's most-recent favorite slot to point at the document they're currently viewing. Useful flow: user is on a favorited document A (slot 3), opens a linked document B (no slot), taps the button — slot 3 now holds B.

### Behavior

- Button label: **"Replace current slot"**.
- Appears at the top of the popup's first stage (the "Send to which list?" doc picker) as a distinct, primary-tinted row above the search input. Visible only when:
  - `favIdxRef.current >= 0` (user has a known last-used slot), and
  - `favorites[favIdxRef.current] !== activeDocId` (active doc isn't already that slot — otherwise the swap is a no-op).
- Subtitle inside the button shows the swap in plain language, e.g. *"Replace 'Document A' in slot 4 with 'Document B'"* using the live titles.
- On press:
  1. Build `next = [...favorites]`, set `next[slot] = activeDocId`, call `saveFavorites(next)`.
  2. Also call `saveLastFavoriteSlot(slot)` so the pointer stays correct.
  3. Close the Send-to popup (`cancelCompose()` — it already resets all send state, and `composeText` is preserved-or-cleared the same as today; if `composeText` is non-empty we leave it alone since the user didn't actually send it... actually `cancelCompose` clears `composeText`, which is fine because this action intentionally replaces the "send idea" flow).
  4. `toast(\`Slot ${slot + 1} now holds "${docB.title}"\`)`.
  5. Re-speak the current sentence of document B using the same pattern as `sendIdea`: `const resume = sentences?.[currentIdx]?.content; if (resume) { const token = claimSpeech(); speak(resume, token); }`.

### Non-goals

- Does **not** modify any sentence content in document A, document B, or anywhere else.
- Does **not** touch `composeText` semantics — it is a slot-pointer swap only.
- Does **not** appear in the `where` or `pickAnchor` stages.

### Files

- `src/routes/_authenticated/app.tsx` — only file touched.
  - Add `replaceCurrentSlot` callback near `sendIdea` (uses `favorites`, `favIdxRef`, `activeDocId`, `docs`, `sentences`, `currentIdx`, `saveFavorites`, `saveLastFavoriteSlot`, `claimSpeech`, `speak`, `cancelCompose`).
  - In the Send-to overlay's `sendStage === "doc"` block (around lines 1935–1970), render the new button above the search `Input`, gated on the visibility conditions above.

### Edge cases

- Active doc already in some other favorite slot: still allowed; user explicitly asked for the *current* slot to be overwritten, duplicates are already tolerated elsewhere in the favorites code.
- `last_favorite_slot` from prefs but `favIdxRef.current` is `-1` on a cold load: the existing restore effect (line 271) sets `favIdxRef.current = lastSlot`, so by the time the popup is openable the ref is populated.
- Muted: `speak()` already respects mute internally — no extra handling needed.