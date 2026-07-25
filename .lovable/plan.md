## Goal
Add a 🔴 / ⬛️ push-to-dictate button in two places, powered by OpenAI Whisper, appending transcribed text to whatever is already in the text field.

## What already exists
- `src/lib/whisper.functions.ts` — server function `transcribeAudio` that posts to OpenAI `/v1/audio/transcriptions` using `OPENAI_API_KEY` (your key, already wired).
- `src/lib/audio-recorder.ts` — `startPcmRecorder()` + `blobToBase64()` producing a clean 16 kHz mono WAV (iOS-safe).

So this is UI plumbing only; no new backend or key setup.

## 1. Shared dictation hook
New file `src/lib/use-voice-dictation.ts`:
- State: `idle | recording | transcribing`.
- `toggle()` — first press starts the PCM recorder; second press stops, encodes WAV, base64s it, calls `transcribeAudio`, and hands the text back through an `onText(text)` callback.
- Guards: microphone-permission failure and empty/too-short clips show a toast instead of calling the API; errors surface the message via toast.
- Appends, never replaces: the caller merges as `existing.trim() ? existing.trimEnd() + " " + text : text`.

## 2. Chat (`src/components/ChatDialog.tsx`)
- In the input row, to the **left** of the `Textarea`, add a circular icon button:
  - idle → 🔴, recording → ⬛️, transcribing → small spinner (disabled).
- On transcription, append the text into `input` and refocus the textarea so the user can edit and press Send normally.
- Sending stays unchanged.

## 3. New idea composer (`src/routes/_authenticated/app.tsx`)
- In the compose action row (`Cancel` / `Send to…`), add the same button to the **right** of `Send to…`.
- Transcribed text appends to the end of `composeText`; pressing 🔴 again records more and appends below/after the current text.
- The button does not open the destination picker — user still presses `Send to…` when ready.
- Recording state here is separate from the orb long-press voice editor, and the button stops event propagation so it never triggers orb gestures.

## Technical notes
- Both buttons reuse one hook, so behavior/styling stay identical.
- No changes to plan mode, orb long-press dictation, or chat capability checkboxes.
