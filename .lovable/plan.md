## Goal
Remove the MP4 export feature entirely, then make sound toggle actions the reliable iPhone entry point for speech so the menu closes and playback starts from a direct button press.

## Plan
1. Remove the MP4 export feature from the app screen.
   - Delete the `exportMp4` recording function and its supporting `recording` state/ref.
   - Remove the `Export MP4` menu item and any related button labels/toasts.
   - Remove any now-unused imports or dependencies created only for recording.

2. Rework the sound menu action so it is iPhone-safe.
   - Replace the current menu sound handler (`saveMuted(!muted); setMenuOpen(false)`) with explicit mute/unmute handlers.
   - On both handlers, close the popup immediately from the same button press.
   - For **mute**: cancel any active speech immediately, persist muted state, and leave the popup closed.
   - For **unmute**: close the popup, persist unmuted state, then synchronously create and speak the currently displayed sentence from that same button press path so iPhone treats it as user-initiated audio.

3. Tighten the speech helper so it works with the new button-trigger flow.
   - Keep the existing text cleanup logic.
   - Add a small helper for “speak the currently visible sentence” so the UI display and spoken text always come from the same source (`currentSentence`).
   - Make sure mute/unmute uses that helper instead of relying on swipe-triggered speech.
   - Preserve cancellation/token behavior so stale utterances do not leak through.

4. Keep swipe navigation behavior, but stop depending on it as the only mobile trigger.
   - Leave sentence/document navigation intact.
   - Ensure swipe paths can still update the current sentence, while the sound toggle becomes the reliable recovery/restart trigger on iPhone.
   - If needed, avoid any extra async hop between the unmute tap and the actual `speechSynthesis.speak()` call.

5. Validate the changed flow against the exact user scenario.
   - Menu opens.
   - Tap sound off: popup closes, audio stops.
   - Tap sound on: popup closes, the currently shown sentence is spoken.
   - Swipe/cycle after unmuting still keeps visible sentence and spoken sentence aligned.

## Technical details
- Primary file: `src/routes/_authenticated/app.tsx`
- Supporting check: `src/routes/__root.tsx` one-time speech unlock stays in place unless it conflicts with the new synchronous toggle flow.
- No backend changes are planned.
- No UI redesign is planned beyond removing the mistaken menu option.

## Expected outcome
- The mistaken MP4 feature is fully gone.
- The sound toggle popup behaves cleanly.
- Unmuting becomes the direct user gesture that reliably triggers speech on iPhone.
- The sentence being shown and the sentence being read stay in sync.