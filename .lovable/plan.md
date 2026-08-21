# Fix repeat MacBook swipes and restore iPhone voice selection

## Goal
Make repeated two-finger trackpad swipes reliable in Chrome and Safari on macOS, keep the existing arrow-key controls, and restore working speech with a selectable iPhone voice.

## Changes

### 1. Replace the one-shot trackpad logic
Update the desktop path in `useOrbGestures` so a physical trackpad gesture is treated as one complete wheel burst rather than a fixed 450 ms cooldown:

- Listen with a native non-passive wheel handler on the Orb interaction area and prevent browser scrolling/history navigation while a valid app gesture is being handled.
- Normalize `deltaMode`, accumulate both axes, choose the dominant axis, and trigger only after a deliberate threshold.
- End and fully reset the gesture after a short quiet period; ignore momentum from that same burst, then accept the next independent swipe immediately.
- Reset all wheel state when input is blocked by a popup/editor so stale deltas cannot poison the next gesture.
- Preserve the existing directions and pointer-drag behavior.
- Keep arrow keys exactly as they work now, including the dialog/editor guard.

### 2. Make iPhone speech restart safely
Strengthen `src/lib/tts.ts` and its app integration:

- Track the time of every cancellation so speech is delayed to a later tick even when `cancelSpeech()` already made `speaking` and `pending` false before `speakText()` runs. This closes the remaining cancel-then-speak path currently used by `claimSpeech()`.
- Keep sequence cancellation, `resume()`, asynchronous voice loading, and the one-time swallowed-utterance retry.
- Avoid retrying an utterance that already ended or errored.
- Prime/unlock speech from the user's Sound/voice-picker interaction on iPhone.

### 3. Add a voice picker to the Sound button
Change the existing Sound menu button so it opens a compact voice sheet containing:

- Sound on/off.
- All English voices currently exposed by that device, including names such as Samantha or Zoe when iOS makes them available.
- A refresh path for the delayed `voiceschanged` list.
- Tap-to-preview before choosing.
- The selected voice saved by `voiceURI` with name/language fallback in device-local storage, because available voice identifiers differ between iPhone and Mac.

All Orb sentence speech and chat read-aloud speech will use the same selected voice. The UI will only list voices returned by the browser; it cannot expose an iPhone voice that is not installed or that iOS withholds from the Web Speech API.

## Verification
- Mac Chrome and Safari: perform several separate two-finger swipes in every direction, including rapid consecutive gestures and gestures after opening/closing the menu; confirm each gesture fires once. Confirm arrow keys still work.
- iPhone Safari/installed web app: open Sound, choose and preview multiple available voices, reload, and confirm the selection persists and repeated sentence swipes speak reliably.
- Confirm mute, chat read-aloud, recording guards, pointer swipes, and dialogs still behave as before.

## Files
- `src/hooks/use-orb-gestures.ts`
- `src/lib/tts.ts`
- `src/routes/_authenticated/app.tsx`
