# Typed redo composer in the media viewer

## Goal

Replace the viewer's voice-only red circle with a Redo button that opens a compact bottom composer. The user can type a requested change, or dictate it into the same box, while still seeing the image or video behind the composer.

## User flow

1. Completed images and videos show a compact **Redo** button in the viewer's lower-left control area instead of the standalone red recording circle.
2. Tapping **Redo** opens a translucent input row just above the wide bottom back bar. The media remains visible behind it.
3. The row contains:
   - A small auto-growing text box, capped at about three lines, with placeholder text like `What should change?`
   - The existing red-circle / black-square dictation button immediately to the right of the text box
   - A clear send button at the far right
4. Voice dictation appends the transcript into the text box and does not submit automatically, so the user can review or edit it first. Typing and dictation can also be combined in one revision request.
5. Pressing send, or pressing Enter on a keyboard, submits the current text. Shift+Enter can add a newline.
6. A close button collapses the composer without submitting. Closing the viewer cancels any active recording and discards the draft.
7. While submitting, the composer disables input and shows a spinner. Errors keep the viewer and text draft open; success closes the viewer back to the gallery and shows the existing generation toast.

## Behavior that stays the same

- Uses the existing `rewriteMediaPrompt` prompt-rewrite step.
- Reuses the current asset, original reference images or videos, aspect ratio, quality, duration, audio, captions, and other generation settings.
- Creates the new media row with the existing `redo N` title flow and revision metadata.
- Starts the same image or video generation functions that the current voice-revise flow uses.
- Remains available only for completed images and videos, not generating, failed, or audio items.
- No database, authentication, or backend schema changes.

## Implementation

- Refactor `src/components/VoiceReviseButton.tsx` into a typed redo composer component, keeping its existing submission and pipeline-selection logic intact.
- Reuse `useVoiceDictation` and `appendTranscript`, but have transcription fill the composer instead of calling submit directly.
- Update the full-screen viewer in `src/routes/_authenticated/media.tsx` to render the collapsed Redo button and expanded composer above the existing bottom back bar.
- Stop click, pointer, and touch propagation inside the composer so typing or pressing its buttons never triggers the viewer's tap zones or swipe navigation.
- Keep the layout safe on mobile with safe-area padding, a maximum composer width, and enough translucency/contrast for use over both images and videos.
- Preserve the existing reference-URL resolution and raw media URL behavior used by generation calls.

## Verification

- Confirm the build passes.
- In the media viewer, verify Redo opens the composer, typed text submits, dictated text appends without submitting, the black-square stop state works, errors keep the draft, and success starts the same regeneration pipeline as before.
