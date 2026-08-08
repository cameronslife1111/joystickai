# Fix "comes back to the top" while keeping the new speed

## What the code actually shows

The speed change made the index save fire-and-forget, but the guard that protects
the index from stale reads is still **time-based**, and that combination is the bug.

In `src/routes/_authenticated/app.tsx`:

- `setIndex` (lines 776-788) records `localIdxRef[docId] = { index, writtenAt: Date.now() }`
  and then fires the database update **without awaiting it**.
- The documents query (lines 324-346) only keeps that local override when
  `pending.writtenAt >= startedAt` (the fetch's start time). Otherwise it
  **deletes the override and trusts the server row**.

So: you swipe (write starts, still in flight) → any refetch that starts a moment
later has `startedAt > writtenAt` → the guard throws the local value away → the
server answers with the *pre-write* index → the reader snaps back. Before the
speed change the `await` meant the write had already landed by then, which is why
this only appeared now. Editing makes it much more likely because the edit path
invalidates queries and calls `setIndex` in the same instant.

Second gap, same root cause: the right-swipe / open-document paths
(lines 1215-1252, and the equivalent blocks at ~980, ~1033, ~1076, ~1846) read
`current_sentence_index` straight from the server and never consult
`localIdxRef`. If that document has an unconfirmed write, the swipe resumes at
the older sentence.

## The fix

### 1. Confirmation-based guard instead of a time race
Track each pending index write by its **promise**, not a timestamp:
- `setIndex` still paints instantly and still does not block the swipe.
- The override for that document stays in place until its own write actually
  succeeds; only then is it cleared. A refetch can no longer discard an
  unconfirmed write.
- If a write fails (dropped cellular request), retry it a couple of times with a
  short backoff and keep the override until it lands, so the position is never
  silently lost.
- Keep the existing "server already matches, drop the override" shortcut.

### 2. Every resume path respects the pending local value
Add one small helper that returns the authoritative saved index for a document
(pending local write if there is one, otherwise the server/cache value) and use
it in all the resume paths: right swipe (both the fast path and the reconcile
step), open linked/pinned document, go-to-document, and recent/previous document.
Result: a right swipe always lands on the sentence you were last on for that
document.

### 3. Flush on background / close
On `pagehide` and on `visibilitychange` → hidden, flush any still-unconfirmed
index write immediately (best-effort) so switching apps or closing the tab can't
strand it.

## Explicitly unchanged

- No `await` is reintroduced on the swipe path — swipes keep painting and speaking
  from cache immediately.
- Speech still comes from the same array the UI renders, by array position
  (display == speech rule intact), and the speech-token cancellation stays.
- Sentence content saves (`commit_document_edit`, inserts, moves, deletes) are not
  touched — they already await their transactional RPCs. This change only concerns
  the "which sentence was I on" pointer.
- Gesture mapping, editor Done / Jump to top, mute, recording, and prefetch
  behaviour all stay as-is.

## Verification

Swipe several sentences deep, right-swipe across three or four documents and
confirm each resumes exactly where it was; edit a document, press Done, leave and
come back and confirm the position holds; background the app mid-swipe, reopen,
and confirm the sentence is preserved; then re-check that swipe up/down and
right still feel instant.

## Files to change

- `src/routes/_authenticated/app.tsx`
