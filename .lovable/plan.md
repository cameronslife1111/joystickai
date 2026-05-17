## Goal
Add a search action to slot 9 of the menu grid so the user can find a document by title and jump straight into it with the current sentence spoken aloud.

## Changes

### 1. New menu action (slot 9)
In `src/routes/_authenticated/app.tsx`, append a 9th item to the `grid` array:
- emoji: 🔍
- label: "Search docs"
- action: close the menu and open a new search overlay (`setSearchOpen(true)`)

### 2. Search overlay
Add `searchOpen` state and `searchQuery` state. Render a modal (same visual pattern as the existing Jump-to overlay around line 1095) containing:
- A single text input, auto-focused, placeholder "Search documents…"
- A live-filtered list of `docs` whose `title` contains the query (case-insensitive). Empty query shows all docs.
- Each result is a tappable row showing the title.

### 3. Selecting a result
On tap:
- Close the overlay and clear the query.
- `setActiveDocId(doc.id)` so the app switches to that document.
- Synchronously (inside the tap handler, iOS-safe) call `window.speechSynthesis.cancel()` then `speak(...)` for that document's current sentence if unmuted. Reuse the exact emoji-stripping + utterance pattern already used in the Sound toggle (lines 663–678) so iPhone Web Speech reliably fires.
- The doc's `current_sentence_index` is already loaded with the doc row, so we can read it directly to fetch the matching sentence content via a small query or by waiting for the sentences query to hydrate. To keep the speak call inside the tap gesture (required by iOS), we will look up the cached sentences for that doc from React Query if present; if not cached, we fall back to a fire-and-forget fetch and skip the immediate speak (the existing auto-read behavior on sentence load will cover it).

### 4. Keyboard / UX
- Pressing Escape closes the overlay.
- Pressing Enter selects the first match.
- Tapping the backdrop closes the overlay.

## Out of scope
- No DB schema changes.
- No changes to send-to, edit, or favorites flows.
- No changes to existing slots 1–8.
