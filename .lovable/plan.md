## Fix: swipe-right cycle speaks the wrong sentence

### Root cause (first principles)
Two timing bugs compound to produce "shows new sentence, speaks previous":

1. **Web Speech `cancel()` → `speak()` race.** Our `speak()` calls `cancel()` then `speak()` synchronously. In Chrome/Safari this is racy: the prior utterance's `onend` hasn't fired yet, the engine swallows the new utterance, and the previous one keeps playing. So after a tap-then-swipe in quick succession, the tap's utterance keeps reading aloud while the new one is dropped.
2. **Pending TTS from the previous handler.** When the user taps the orb (queueing TTS for sentence N), then immediately swipes right, the `await supabase.from("sentences")...` round-trip in `onSwipeRight` takes ~50–200 ms. During that window the previous utterance is already playing. By the time we finally call `speak(newContent)` it collides with cause #1.

A third latent issue: `targetDoc.current_sentence_index` is read from the React Query docs cache, which can lag the DB if another tab/device updated it. Reading the index from DB at swipe time removes any chance of staleness.

### Hard rule
The orb may only speak a sentence that is currently being displayed. To guarantee this:
- Every call to `speak()` invalidates any in-flight or queued utterance.
- A monotonically increasing "speech token" gates every `speak()` call — if a newer swipe/tap has fired between the time we requested the fetch and the time we'd start speaking, the older speak is dropped.
- The active sentence shown to the user and the text passed to `speak()` come from the same fetch result, so they cannot disagree.

### Changes (single file: `src/routes/_authenticated/app.tsx`)

1. **Harden `speak()`**
   - Add a `speechTokenRef = useRef(0)`.
   - Replace `speak` with `speak(text, token?)`:
     - `window.speechSynthesis.cancel()`.
     - If `token != null && token !== speechTokenRef.current`, return (a newer request superseded this one).
     - Use a short `setTimeout(0)` between cancel and `speak()` so Chrome/Safari flushes the canceled utterance before the new one is queued (a known browser quirk).
     - Set `utterance.onstart` to no-op; `onerror` to no-op; do not chain.

2. **Bump the token at the start of every user-driven speech action**
   - In `onTap`, `onSwipeUp`, `onSwipeDown`, `onSwipeRight`, `jumpTo`, `onLongPressEnd` (after AI insert), and `commitEdit` (if it speaks): call `const token = ++speechTokenRef.current;` first, then call `window.speechSynthesis.cancel();` immediately, then proceed. Pass `token` into `speak(text, token)` at the end.
   - This means a fast tap → swipe sequence cancels the tap's TTS immediately on the swipe, before the swipe's network round-trip.

3. **Make `onSwipeRight` correctness-first, then fast**
   - Bump token + cancel TTS at the very top.
   - Compute target doc (favorites cycle or fallback) as today.
   - **Re-fetch the target doc's `current_sentence_index` from DB** in parallel with the sentence content fetch:
     ```ts
     const [{ data: d }, _ignored] = await Promise.all([
       supabase.from("documents")
         .select("current_sentence_index")
         .eq("id", targetDoc.id).single(),
       Promise.resolve(),
     ]);
     const targetIdx = d?.current_sentence_index ?? 0;
     const { data: row } = await supabase.from("sentences")
       .select("content")
       .eq("document_id", targetDoc.id)
       .eq("order_index", targetIdx)
       .maybeSingle();
     ```
     (Two sequential queries are required because the sentence lookup needs the doc's index; both are sub-100ms over the publishable client.)
   - After fetch, if `token !== speechTokenRef.current`, abort (user swiped again).
   - `setActiveDocId(targetDoc.id)`, then optimistically write the fresh `current_sentence_index` into the docs cache so the header counter renders consistently with the spoken sentence.
   - `speak(row.content, token)`.

4. **Same pattern for the all-docs fallback path** in `onSwipeRight`.

5. **No UI/layout changes.** No toasts on swipe-right (already removed).

### Why this fixes the symptom
- Cancel-then-speak with a `setTimeout(0)` gap is the documented workaround for Chrome/Safari's `speechSynthesis` cancel race. The new utterance is no longer swallowed.
- Bumping the token at the very start of the handler kills the previous tap's queued TTS before the network round-trip can let it finish.
- Re-fetching `current_sentence_index` at swipe time guarantees the spoken text matches the sentence that will actually be rendered when the sentences query for the new doc loads — no stale-cache mismatch.

### Out of scope
- Caching/preloading neighbor docs' sentences for instant playback.
- Switching to a server-side combined doc+sentence RPC.
- Replacing Web Speech with a cloud TTS provider.
