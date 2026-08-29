# Fix Delegate: the request is silently dropped

Delegate opens a fresh chat, shows "reading the document", then nothing happens. The analysis step actually succeeds — the send that should follow it never runs, so no message, no plan, no review card.

## Cause

In `src/components/ChatDialog.tsx` the Delegate runner is memoized with only the analysis function as a dependency, so it permanently captures the very first render's `handleSend`. On that first render the signed-in user id is still `null` (it's loaded into state after mount), and `handleSend` starts with a silent early return when there is no user id. So Delegate analyses the step, hides the spinner, calls a stale `handleSend`, and that call returns immediately without inserting a message or creating a plan — no error, no toast.

That's why planning still works everywhere else: normal sends use the live `handleSend` from the current render.

## Fix

1. Keep a ref to the current `handleSend` (assigned on every render) and have the Delegate runner call through that ref instead of the captured closure. This removes the stale-closure class of bug rather than just this one instance.
2. Have the Delegate runner surface failures instead of failing quietly: if the send does not produce a plan row, show a toast ("Couldn't delegate that step") and leave the thread usable.
3. Keep the spinner up until the send has actually been dispatched, so "reading the document" doesn't disappear before anything happens.

## Verification

With a document open and a sentence selected, hold the purple orb (and separately use menu slot 15): a `Delegate: <title>` chat opens with the document attached, the spinner runs, the delegate request appears as the user message, and the review card renders with the detected task, the capabilities Orby picked, the steps, and Approve / Add a note / Cancel. Add a note replans; Approve runs it in the background.

## Technical notes

- Only `src/components/ChatDialog.tsx` changes: add `handleSendRef` (`useRef`, updated each render), call `handleSendRef.current?.(...)` inside `runDelegate`, and keep the existing nonce guard so two rapid taps still create one thread and one plan.
- No schema, edge function, prompt, or capability-routing changes.
