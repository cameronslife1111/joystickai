
## Goal

Change Orb long-press so instead of creating a chat/plan, it becomes a **voice document editor** scoped to the current document. Whisper transcribes what you say; an AI interprets it as edit instructions (change/replace/insert/delete sentences, or "web-search X and insert after this sentence"); the edits are applied directly to the doc you're on. When done, view snaps to the affected sentence, speech resumes, and normal swipe/edit still work while recording.

## Behavior

- **Long-press 1**: start recording (red aura as today). Speech/auto-read pauses. Swipes and single-tap-to-edit still work; sentence auto-reading is muted.
- **Long-press 2**: stop → transcribe (Whisper) → send transcript + doc context (title, all sentences with indexes, current sentence index) to a new server function that returns a list of structured edit operations → apply → jump to primary edited sentence → resume speech.
- **Scope**: only the current `activeDocId`. No chat thread, no plan row, no scheduling.
- Toasts: "Transcribing…" → "Editing document…" → "✅ Updated N sentences" (or error).

## Supported edit ops (single AI call, structured output)

- `replace_sentence(index, newText)`
- `edit_sentence(index, newText)` (alias of replace, for word-level rewrites)
- `insert_sentences(afterIndex | atIndex, texts[])`
- `delete_sentences(indexes[])`
- `move_sentence(fromIndex, toIndex)`
- `web_search_and_insert(query, afterIndex, style?)` — server calls Perplexity (`PERPLEXITY_API_KEY` already set) or falls back to OpenAI, splits result into sentences, inserts.

All ops reuse existing RPCs (`insert_sentences_at`, `move_sentence`, sentence UPDATE/DELETE) so ordering invariants stay intact.

## Files

**New — `src/lib/voice-edit.functions.ts`**
`voiceEditDocument({ documentId, transcript, currentSentenceIndex })` server fn (auth middleware):
1. Loads doc + all sentences (ordered).
2. Calls OpenAI (`gpt-5.5` via existing `createOpenAiProvider`) with strict JSON schema for the ops above; system prompt: "You edit ONE document based on the user's spoken instructions. The user is currently on sentence {i}. Interpret 'this sentence' / 'here' as that index. Return ops only."
3. For `web_search_and_insert`, call Perplexity `sonar` server-side, then split into sentences via `splitIntoSentences`.
4. Execute ops in order (delete indexes sorted desc to keep indexes stable; inserts use `insert_sentences_at`).
5. Return `{ appliedCount, focusIndex }` (focusIndex = first inserted/edited sentence).

**Edit — `src/routes/_authenticated/app.tsx`**
- Replace `dispatchVoiceMessage` with `dispatchVoiceEdit(blob)`:
  - transcribe (existing `transcribeAudio`)
  - call `voiceEditDocument({ documentId: activeDocId, transcript, currentSentenceIndex: currentIdx })`
  - `qc.invalidateQueries({ queryKey: ["sentences", activeDocId] })`
  - `jumpTo(focusIndex)` and let speech resume (existing mechanism)
  - Toast success/error
- While `recording === true`: gate the existing auto-speak so it stays silent (add a `recording` check where `speak(...)` is called for sentence advance). Swipes/edit remain untouched.
- Delete `sendChat`/`nameChatThread` usage from the long-press pathway (keep imports if used elsewhere; ChatDialog still uses them).

**No DB migrations. No changes to plan/chat systems.**

## Technical notes

- Perplexity: server-only fetch to `https://api.perplexity.ai/chat/completions` with `sonar`, gated on `PERPLEXITY_API_KEY`; if the key isn't present or errors, fall back to OpenAI text generation so the feature still works.
- Structured output: use `generateText` + JSON parsing helper (same pattern as `orby-call-docs.functions.ts` `tryParseJson`) — keeps consistency with existing code.
- Index math for `delete + insert` combos: apply deletes first (desc), then re-fetch count for inserts, or accept that AI returns ops against the pre-edit indexes and we translate — simplest correct approach: **apply ops sequentially, recomputing indexes** after each mutation by re-reading the sentence list once per op batch of the same type.
- Focus-index: if an insert happened, use its first new index; else the first replaced/moved index; else `currentIdx`.
- No changes to `useOrbGestures` or the recording UI (red aura already gated by `recording`).
