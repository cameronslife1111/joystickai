# Add 🔴 voice dictation to the media prompt popups

Put the same red-circle / black-square transcribe button that chat uses right next to the "Attach documents" button in every media generation popup, so you can speak your prompt instead of typing it.

## Where it gets added

- Remix Images (step 2 prompt box)
- Image to Video
- Video to Video
- Generate Image
- Regenerate / Revise Image

In each one, the button sits on the same row as "Attach documents", directly beside it.

## How it behaves

- Tap 🔴 to start recording, tap ⬛️ to stop; a spinner shows while it transcribes.
- Transcribed text is appended to whatever is already in the prompt box (never replaces it).
- Errors (no mic permission, silence, too-short clip) show a toast, exactly like chat.
- The mic is fully released after each recording so the phone's recording indicator drops.

## Technical notes

- Reuse the existing `useVoiceDictation` hook and `appendTranscript` helper from `src/lib/use-voice-dictation.ts` — no new backend work, it already calls the Whisper server function.
- Add a small shared `DictateButton` component (`src/components/DictateButton.tsx`) wrapping the hook + 🔴/⬛️/spinner icon-button markup copied from `ChatDialog.tsx`, so all five dialogs stay consistent.
- Wire each dialog with `<DictateButton onText={(t) => setPrompt((p) => appendTranscript(p, t))} />` next to its existing Paperclip button, wrapping the pair in a flex row that wraps on narrow screens (keeps the recent mobile-overflow fixes intact).
- The Image to Video negative-prompt field is left alone; only the main prompt box gets the button.
