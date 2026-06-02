# Slot 19 → Pinned Document button (📌)

## Goal
Replace the slot 19 menu button (currently ↗️ "Open link") with a 📌 **Pin** button.

- **Single press** → immediately opens the pinned document right where the user is, resumes at the doc's saved sentence, and triggers speech — exactly like opening a linked doc / favorite.
- **Long press** → opens a document picker so the user can choose which single document to pin.

All existing "open link" behaviors stay untouched: swipe-right on the orb still opens a sentence's linked doc, and the little link chip under the title still works. We are only removing the redundant "Open link" *menu* button and reusing that slot for the pin.

## What stays the same
- `openLinkedDocument()`, swipe-right link handling, and the linked-doc chip button (lines ~631–680, ~1563–1578) — all unchanged.
- All other slot positions stay where they are.

## Changes

### 1. Store the pinned document (backend)
Add a `pinned_document_id uuid` column (nullable) to the `user_preferences` table via migration. No new RLS needed — the existing own-row policies already cover it.

### 2. Load & save the pin (`app.tsx`)
- Extend the `user_preferences` query (lines ~218–227) to also select `pinned_document_id` and expose a `pinnedDocId` value.
- Add a `savePinnedDoc(docId)` callback that upserts `pinned_document_id` and optimistically updates the query cache (mirrors `saveLockFavorites`).

### 3. Open-pinned-document logic
Add an `openPinnedDocument()` callback modeled on the existing favorite/linked-doc open flow:
- If no pin is set, show a toast: "Long-press the pin button to choose a document."
- If the pinned doc no longer exists, clear the pin and toast an error.
- Otherwise: claim speech, fetch the target doc's saved index + ordered sentences, prime the caches, `setActiveDocId(pinnedDocId)`, and speak the resolved sentence — identical pattern to `openLinkedDocument` (lines 631–680).

### 4. Replace the slot 19 menu entry
- In the menu grid array, change the ↗️ "Open link" item (line ~1474) to a 📌 item titled "Pinned doc".
  - Its `fn` (single press) calls `openPinnedDocument()` then closes the menu.
  - Add an optional `onLongPress` handler on this item that opens a new pin-picker overlay.
- `grid[19]` already maps to slot 19 (`filled[18] = grid[19]`), so no slot remapping is required.

### 5. Long-press support on menu buttons
The menu buttons are currently plain `<button onClick={slot.fn}>` (lines ~1806–1831). Add optional `onLongPress` support:
- Extend the slot item type with an optional `onLongPress?: () => void`.
- On each grid `<button>`, attach pointer/touch handlers that start a ~500ms timer on press-down; if it fires, call `onLongPress` and suppress the subsequent click; otherwise the normal `onClick` runs. (Same timing approach already used by `use-orb-gestures`.)

### 6. Pin-picker overlay
Add a lightweight document-picker overlay (new `pinPickerOpen` state) reusing the existing doc-list UI pattern (like the favorites slot picker / search list, lines ~1993). Selecting a document calls `savePinnedDoc(doc.id)`, closes the picker, and shows a confirmation toast. Include a "Remove pin" option when one is already set.

## Result
Slot 19 becomes 📌. A single tap jumps straight to the pinned document with speech; a long press lets the user pick/change/clear which document is pinned. Everything is persisted in user preferences, and all prior link-opening features remain intact.
