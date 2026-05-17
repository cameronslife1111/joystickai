## Goal
Make cycling between documents fully deterministic so these three things always stay in sync:
- the loaded document
- the currently displayed sentence
- the sentence spoken by web speech

## What I found
The current cycle flow is vulnerable to drift because it mixes two different concepts of “current sentence”:
- `current_sentence_index` on the document, which the UI uses as an array position
- `order_index` on sentence rows, which the cycle path uses to fetch speech text

After edits, deletes, inserts, or undo flows, those can stop matching exactly. When that happens, the app can display one sentence while speech reads a different one.

There is also a race risk during document switching:
- the next doc is selected
- speech text is fetched separately
- the active doc and sentences query update afterward

That makes it possible for speech to run from stale lookup data instead of the exact sentence the UI settles on.

## Plan
### 1. Unify sentence resolution around one source of truth
Refactor the app so the current sentence is always resolved by:
- loading the target document’s ordered sentence list
- clamping the saved `current_sentence_index` against that list length
- deriving the spoken text from that exact resolved sentence object

This removes the `order_index === current_sentence_index` assumption from the cycle path.

### 2. Make cycle load document and sentence together
Rewrite the swipe-right cycle flow so it:
- picks the next target document
- fetches that document’s latest saved `current_sentence_index`
- fetches the target document’s full ordered sentence list
- resolves the exact sentence object at that clamped index
- updates cache/state for the target document before speaking
- only then triggers speech for that exact resolved sentence

If the document has no sentences, it will switch documents without speaking.

### 3. Clamp and persist index consistently after mutations
Harden all sentence-changing paths so `current_sentence_index` never points past the real list:
- delete current sentence
- full edit save
- AI insertions
- send-to/current-position insertions
- jump/advance/back actions

Where needed, I’ll make the cache and persisted document index update from the same resolved list length so future cycles always reopen on a valid sentence.

### 4. Add a small sync helper instead of repeating fragile logic
Extract a focused helper for “resolve current sentence for a document” that handles:
- ordered sentence fetching
- index clamping
- cache update for corrected index
- returning the exact sentence to display/speak

That keeps the cycle code, jump code, and mutation follow-ups using the same rules.

### 5. Validate all speech entry points
Review every `speak()` caller and ensure each one passes the sentence object that is actually being shown, including:
- swipe right cycle
- swipe up/down navigation
- jump to
- delete
- edit save/jump
- AI continuation insert

The existing mute behavior and emoji stripping will stay intact.

## Technical details
- File to update: `src/routes/_authenticated/app.tsx`
- No new UI required
- No schema change needed unless I discover the stored index itself is being persisted incorrectly
- I’ll keep the current token-based speech cancellation, but make the resolved sentence object the only speech source

## Expected outcome
After the fix, when a user cycles to another document:
- the document opens on the last saved sentence position
- that same sentence is what appears on screen
- that same sentence is what speech reads
- no title and no stale sentence will ever be spoken during the switch