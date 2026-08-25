# Update orb icons and harden iPhone microphone recording

## Goal
Replace the six smiley faces in the home orb cluster with action-specific icons, while keeping the current orb size, placement, colors, spacing, and behavior. Also make voice recording reliable on iPhone 16E / iOS 27 beta so the chat mic, media redo mic, editor dictation mic, and center-pad long-press recording can start consistently.

## Current state confirmed
- `src/components/OrbCluster.tsx` renders one shared `Smiley` SVG inside every colored orb.
- The orb sizing and layout live in `src/styles.css`; the recent larger size and placement are controlled by `.orb-cluster`, `@utility glow-orb`, and `.glow-orb-face`.
- The shared recorder is `src/lib/audio-recorder.ts`; it already reuses one `AudioContext`, keeps a warm stream, retries `getUserMedia` once, and maps known permission/busy errors.
- The red mic buttons use `useVoiceDictation`, which calls `startPcmRecorder`; the center-pad long press in `src/routes/_authenticated/app.tsx` also calls `startPcmRecorder` directly.
- The current generic toast, "Couldn't start the microphone — please try again", is the fallback for errors that are not currently classified as permission, busy, or missing-device errors. There are no captured runtime errors in the preview logs for this issue.

## Changes

### 1. Replace smiley faces with function icons
- Replace the shared `Smiley` component in `OrbCluster.tsx` with an icon slot per orb.
- Use lightweight existing icon components for:
  - Blue top orb: up arrow / previous sentence.
  - Purple bottom orb: down arrow / next sentence.
  - Green inner-right orb: document icon / next document.
  - Yellow inner-left orb: menu icon / open menu.
  - Red outer-left orb: trash can / delete sentence.
  - Orange outer-right orb: speak / read-repeat icon.
- Keep the same buttons, labels, click handlers, grid placement, colors, pulse, and giggle animation.
- Update the icon styling class in `styles.css` from smiley-specific naming to a reusable orb icon class, preserving the current icon scale and contrast.

### 2. Make recorder startup more tolerant on iPhone
- Add a stronger microphone acquisition helper in `audio-recorder.ts`:
  - Check for missing `navigator.mediaDevices.getUserMedia` before attempting to record.
  - Retry transient iOS failures more than once with a bounded delay ladder instead of only one 300 ms retry.
  - Treat `AbortError`, `InvalidStateError`, `UnknownError`, and WebKit-style interruption messages as transient microphone startup failures.
  - Fully discard stale warm streams and rebuild a bad/interrupted recorder `AudioContext` before retrying.
- Add a bounded `AudioContext.resume()` helper so a suspended/interrupted iOS audio context cannot hang or poison future mic starts.
- On foreground return (`pageshow`, `visibilitychange`, `focus`), mark recorder state stale so the next mic press starts from a fresh stream/context rather than a half-dead iOS audio session.
- Keep the microphone released after recordings finish so the iPhone recording indicator turns off and text-to-speech can continue to work independently.

### 3. Improve error messages without hiding real failures
- Expand `micErrorMessage` so iOS-specific transient errors tell the user the mic could not start yet and to try again, instead of implying app permission is off.
- Preserve the clear permission message only for true denied-permission errors.
- Preserve the busy-message path for cases where another app is actively holding the mic.

### 4. Optional fallback if Web Audio fails after the mic opens
- If `getUserMedia` succeeds but Web Audio setup fails, fall back to a short `MediaRecorder` capture path when supported.
- Send the actual recorded MIME type to the existing transcription function.
- Keep this fallback behind the same `PcmRecorder` interface so all mic buttons continue sharing one recorder API.

## Files to change
- `src/components/OrbCluster.tsx`
- `src/styles.css`
- `src/lib/audio-recorder.ts`
- `tests/audio-recorder.test.ts`

## Verification
- Run the focused recorder tests and add coverage for transient iOS retry, stale context rebuild, and error-message mapping.
- Check the app preview: all six orbs keep the same size/placement and show the new icons clearly.
- Confirm each orb still performs the same action.
- On iPhone: press the chat mic and media redo mic repeatedly, leave the app and use another recording app, return, and confirm recording starts without restarting the web app.

## Out of scope
- No changes to orb size, placement, colors, or spacing.
- No changes to what each orb button does.
- No changes to the text-to-speech voice list or pricing gates.
