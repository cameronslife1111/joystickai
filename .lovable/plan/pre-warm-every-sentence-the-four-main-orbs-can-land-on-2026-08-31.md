# Pre-warm every sentence the four main orbs can land on

Today only the current document is warmed, and only in the direction you were last travelling (plus one behind). So the blue/purple orbs are usually instant, but the green orb (next document) and the orange orb (pinned document) still pay a full generation the first time you land there.

## What changes

1. **Current document: always both neighbours.** Warm the sentence before and the sentence after the one you're on, regardless of which way you were last moving. Direction only decides ordering (the likely direction goes first in the queue) and any extra lookahead.
2. **Green orb target is always warm.** The app already prefetches the sentence *list* of the document the green orb will open next. Extend that: once the list is in cache, resolve the sentence that document will actually open on (its saved index, clamped) and queue that sentence's audio too. So the first press of green plays from cache.
3. **After a green-orb press, chain forward.** When landing on a new document, immediately warm that document's next sentence (and previous), plus the sentence of the *following* green-orb target, so repeated green presses stay instant.
4. **Orange orb target is always warm.** Same treatment for the pinned document: prefetch its sentence list, resolve its landing sentence, and warm that audio. Re-warm whenever the pinned document changes or its saved index moves.
5. **Priority order.** The queue is always: the sentence you're waiting on (never queued — spoken directly), then next/previous in the current document, then the green target, then the orange target, then any extra lookahead. A new orb press cancels whatever prewarm is still in flight, so the live sentence always wins the bandwidth.
6. **Gates unchanged.** Nothing warms when Sound is off, during hands-free calls, or while recording. Clips stay persisted, so each sentence is generated once per voice — a warmed green/orange landing sentence is never re-billed on later visits.

## Setting behaviour

The existing **Prefetch ahead** control (Off / 1 / 2) keeps its meaning for extra lookahead inside a document. The four orb landing sentences (previous, next, green target, orange target) are treated as the baseline set and are warmed at depth 1 and 2. **Off** still means no prewarming at all.

## Technical notes

- `src/routes/_authenticated/app.tsx`: rework the prewarm effect into a single `warmOrbTargets` helper that builds one ordered target list from: current doc neighbours (both sides), the resolved green-orb target sentence, and the resolved pinned-doc target sentence. Reuse the existing favorites/all-docs cycle logic that already picks the green orb's next document, and `savedIndexFor` to resolve each landing index from the cached list. Extend the existing sentence-list prefetch effect to also cover the pinned document id. Re-run on `activeDocId`, `currentIdx`, `favorites`, `pinnedDocumentId`, voice, mute, and depth changes, keeping the small delay so the live sentence starts first.
- `src/lib/speech.ts`: no engine changes needed — `prewarmSentences` already replaces the queue and aborts in-flight work; targets are passed as one ordered array.
- `tests/speech.test.ts`: add coverage that a cross-document landing sentence queued through `prewarmSentences` plays with no network call, and that a new call supersedes a pending queue.

## Out of scope

No voice, orb, gesture, or visual changes; no change to the 1.15x pace; no new database columns.
