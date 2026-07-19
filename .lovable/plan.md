## Goal

Make the orb long-press behave as a toggle: first long-press starts recording, second long-press stops it and fires transcription. No holding required.

## Change

In `src/routes/_authenticated/app.tsx`, rework the two long-press handlers around lines 1356–1388:

- `onLongPressStart` becomes the single toggle entry point.
  - If `recorderRef.current` is already set → treat this long-press as the STOP action: capture the recorder, clear the ref, `setRecording(false)`, `await rec.stop()`, and if the clip passes the existing duration/size floor call `dispatchVoiceMessage(blob)`. (Same logic that currently lives in `onLongPressEnd`.)
  - Otherwise → start a new recording exactly like today (`setRecording(true)`, `startPcmRecorder()`, error toast on failure).
- `onLongPressEnd` becomes a no-op (return immediately). We keep passing it so `useOrbGestures` still fires the start callback, but releasing the finger no longer stops the mic.
- Keep the `editing` guard on start so edit mode still blocks recording.
- Keep `recordStartMsRef` for the duration floor; it's set at start, read at stop.

Nothing else changes: the red pulsing aura (`recording` state), the fire-and-forget `dispatchVoiceMessage` pipeline (transcribe → new thread → send with scheduling + all other planner capabilities), and the toast flow all stay intact. Scheduling capability in the planner is unaffected because that lives in `plan-compose` / chat capability toggles, not in the recording path.

## Technical details

- File touched: `src/routes/_authenticated/app.tsx` only.
- No changes to `audio-recorder.ts`, `whisper.functions.ts`, `useOrbGestures`, or the planner.
- The existing 400ms / 4096-byte guard still protects against accidental double long-presses that stop instantly.
