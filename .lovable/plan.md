# Restore reliable sentence speech

## Confirmed findings

- The saved sound preference is currently **on** (`muted = false`), so the database setting is not blocking speech.
- The open browser exposes speech synthesis, is not paused, and has 199 installed voices with a valid system-default voice.
- Swipes reach the app’s navigation handlers and those handlers call the sentence speech path.
- The current regression is in the new gesture/speech sequencing:
  - every orb press calls `prepareSpeech()` before the app knows whether the gesture is a swipe;
  - `prepareSpeech()` always calls `speechSynthesis.cancel()`, even when the queue is idle;
  - the replacement speech engine then calls `speak()` without the settle/retry protection that existed before the latest simplification.
- Browser speech engines can silently discard an utterance while a preceding cancellation is still being processed. The current path therefore risks `cancel → speak` on every swipe, with no `start`, `end`, or `error` event.

## Fix

1. **Remove cancellation from gesture start**
   - Stop calling `prepareSpeech()` on every pointer/touch/mouse down.
   - Leave the gesture mappings and visual behavior unchanged.
   - This restores the clean first-use path: a swipe directly submits speech during the user gesture without first disturbing an idle browser queue.

2. **Make one small speech controller own replacement behavior**
   - Keep the browser/device default voice by leaving `utterance.voice` unset; this lets Chrome, Safari, iPhone, Android, and desktop browsers choose their configured default.
   - If the speech engine is idle, speak immediately and synchronously.
   - Only call `cancel()` when speech is actually active or pending; wait for the old queue to become idle before submitting the newest sentence.
   - Retain a strong reference to the active utterance until it ends or errors.
   - Coalesce rapid swipes so only the newest requested sentence can speak.

3. **Recover from silent browser drops without complicating normal playback**
   - Detect when an utterance never fires `onstart` and retry it once after confirming the queue is idle.
   - Re-read the current voice list before a retry, but do not force a named voice or language; the system default remains authoritative.
   - Cancel/reset speech when the page is hidden so returning to the app starts from a clean queue.
   - Keep development-only event diagnostics for `queued`, `start`, `end`, and browser-reported errors.

4. **Verify the exact regression path**
   - Add focused tests for: first idle swipe, replacing active speech, rapid consecutive swipes, silent-start retry, cancellation, and default-voice behavior.
   - Drive real orb swipes in the authenticated app and confirm the displayed sentence is submitted once, the queue starts, and no unconditional cancel occurs before first speech.
   - Check build and runtime diagnostics after the change.

## Files to change

- `src/lib/speech.ts`
- `src/routes/_authenticated/app.tsx`
- `src/hooks/use-orb-gestures.ts`
- A focused speech test file using the project’s existing test setup

## Out of scope

No new buttons, voice picker, gesture remapping, visual changes, database changes, or hosted AI voice service.
