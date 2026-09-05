# Stop reading aloud when a chat is cleared

## The problem

With "Read replies aloud" on, tapping the trash can and confirming "Clear" wipes the messages but the voice keeps reading the bubble it was already reading. It should go quiet the moment the chat is cleared.

## Cause

The clear action deletes the messages and empties the list, but nothing tells the voice to stop — the reading that was already underway simply continues to the end.

## The fix

- The moment "Clear" is confirmed, stop any reading in progress and reset the play/stop state so no bubble looks like it is still being read.
- Do this before the deletion runs, so it is instant even if the delete takes a moment or fails.
- Also reset the "already read this chat's latest reply" marker for that chat, so the next reply that arrives after clearing is read once as normal instead of being skipped.
- Leave everything else as is: per-message Play buttons, the auto-read on opening a chat, closing the chat stopping speech, and hands-free calls still suppressing auto-read.

## Technical notes

`src/components/ChatDialog.tsx`, `handleClear`: call `cancelSpeech()` and `setSpeakingId(null)` first, and clear `autoSpokeThreadRef.current` when it matches the cleared thread. No changes to `src/lib/speech.ts`.

## Verification

Start a reply reading aloud, press the trash can, confirm Clear, and check the voice cuts off immediately and the bubble's play state resets; then send a new message and confirm the reply still reads aloud.
