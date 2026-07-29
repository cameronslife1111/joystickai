## Goal

Add a floating 🔴 / ⬛️ voice-dictation button while the full-document editor is open (orb press → text editor). Transcribed text lands exactly where the cursor was when recording started.

## Placement

A fixed-position button in `src/routes/_authenticated/app.tsx`, rendered only when `editing` is true:

- `position: fixed`, `right: ~4vw`, `bottom: 60%` of the viewport height (using `svh` so mobile browser chrome doesn't shift it).
- High `z-index` so it floats above the textarea, and stays visible while the mobile keyboard is open (fixed + `svh` keeps it clear of the keyboard).
- Same visual treatment as the existing New Idea dictation button: round translucent pill with the aurora glow, showing 🔴 (idle), ⬛️ (recording), … (transcribing).

## Behavior

1. On `pointerdown` the button calls `preventDefault()` so the textarea never blurs and the mobile keyboard stays open.
2. First tap: capture the current caret position (`selectionStart` / `selectionEnd` of `editTextareaRef`) into a ref, then start recording via the existing `useVoiceDictation` hook (OpenAI Whisper through `transcribeAudio`).
3. Second tap: stop, transcribe, and splice the returned text into `editText` at the saved caret offset — replacing the selection if there was one, and adding a single space before/after only when needed so words don't run together.
4. After insertion, restore focus to the textarea and place the caret at the end of the inserted text, so the user can keep typing or record again (a second recording starts from the new caret).
5. If the caret was never placed (no saved position), fall back to appending at the end of the document text.

## Technical notes

- Reuses `useVoiceDictation` from `src/lib/use-voice-dictation.ts` — no new server code; `transcribeAudio` in `src/lib/whisper.functions.ts` already handles the Whisper call.
- The hook's `onText` callback needs live access to the latest `editText`; it will use a functional `setEditText(prev => …)` update to avoid stale state.
- Existing edit-mode navigation guards (`editingRef`) are untouched — the button is inside the editor UI only and stops event propagation so no orb gestures fire.
- Recording is cancelled automatically if the editor closes (Done / Jump To / Escape) so the mic is never left open.

Only `src/routes/_authenticated/app.tsx` changes.