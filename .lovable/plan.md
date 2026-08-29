# Fix: Delegate opens the old delegate chat instead of the new one

Holding the purple orb on a new step correctly creates a new Delegate chat and plan, but the chat window then snaps back to a previously created Delegate thread, so you review/see the wrong conversation.

## Cause

The chat window has two things racing to decide which thread is on screen:

1. The Delegate flow, which creates a brand-new thread and selects it.
2. The normal "which chat should I open?" bootstrap, which restores the last chat you were on (stored in the browser as `orby_last_thread`).

The bootstrap is meant to stand down while Delegate is running, but its guard stops applying the moment Delegate marks the tap as handled. Right after the new thread is created, the bootstrap runs anyway and switches the view back to the remembered (older) Delegate thread — while the new plan quietly continues in the thread you can no longer see.

## Fix

- When a Delegate tap is in play, the chat window marks the bootstrap as already done, so it never picks a thread for that session — Delegate is the only thing that sets the active thread.
- The freshly created Delegate thread becomes the remembered "last chat", so reopening chat later lands on it rather than an older one.
- The Delegate thread selection also force-closes the thread list, keeping the new conversation front and center (already the intent, kept explicit).

## Technical notes

`src/components/ChatDialog.tsx`:

- In the bootstrap effect, replace the early `return` for an unhandled delegate payload with: set `bootstrappedRef.current = true` and return whenever `delegate` is present. This blocks both the pre- and post-handling passes (the current bug is the post-handling pass restoring `orby_last_thread`).
- Keep the `delegate.id` nonce guard in the delegate effect so one tap creates exactly one thread/plan.
- No changes to `app.tsx`, plan composition, or the review card.

## Verification

Delegate one step, wait for the review card, close chat. Move to a different sentence and hold the purple orb again: a second `Delegate: <doc>` thread opens, shows its own "Reading your document" then its own review card, and does not flip back to the first Delegate thread. Opening chat normally afterwards lands on the newest Delegate thread; the earlier plan keeps running in its own thread.
