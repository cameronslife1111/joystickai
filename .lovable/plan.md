# Fix silent device speech on iPhone

## Confirmed diagnosis

- Orby’s mouth animation polls `speechSynthesis.speaking`; it does not confirm that audible speech began. The reported moving mouth therefore matches an iOS queue that is marked active but produces no sound.
- The current first-gesture unlock in `src/lib/speech.ts` queues `"\u00a0"`, a non-breaking-space utterance. The project’s own earlier WebKit-specific implementation explicitly removed this pattern because speechless primer utterances can remain stuck as `speaking = true` and hold every real sentence behind them.
- When that primer is active, the current iPhone branch calls `cancel()` and immediately submits the real sentence in the same event. This recreates the WebKit cancellation race where the new utterance can be cleared silently.
- The current sentence utterance leaves both `voice` and `lang` unset. That works on the MacBook, but there is no explicit local-device fallback when iPhone Chrome fails to resolve its implicit default.

## Fix

1. **Remove the queue-blocking primer**
   - Keep the existing first-gesture listener, but use it only to warm `getVoices()` and resume a paused synthesizer.
   - Never enqueue whitespace, silent, or otherwise unpronounceable text.
   - Re-warm/resume when the app returns to the foreground so an interrupted iPhone audio session can recover.

2. **Restore safe iPhone queue sequencing**
   - For an idle queue, submit the real sentence immediately inside the swipe completion event.
   - When replacing active speech, cancel exactly once, wait until WebKit reports the queue idle, then submit the newest sentence.
   - Remove the current iPhone-only same-tick `cancel()` → `speak()` path.
   - Keep rapid swipes coalesced so only the newest requested sentence is read.

3. **Use a real on-device voice fallback**
   - Resolve a fresh voice for every utterance rather than caching voice objects.
   - Prefer the device/browser voice marked as default; otherwise use a local voice matching the iPhone language, then any available local voice, then the first available voice.
   - Assign the resolved voice and its language to the utterance. If the voice list is initially empty, refresh it and retry once when voices become available.
   - Keep all speech inside the device’s Web Speech API; no hosted voice service, audio file, or new UI.

4. **Make recovery safe**
   - Keep a strong reference to each active utterance until it ends or errors.
   - Preserve the silent-drop watchdog, but never cancel an utterance merely because `onstart` was delayed while WebKit still reports it active.
   - Reset stale queue state after backgrounding so the next swipe starts cleanly.

5. **Verify the regression path**
   - Expand the speech tests to cover: no primer utterance, direct first swipe, fresh default/local voice selection, delayed voice availability, replacement only after cancellation settles, rapid-swipe coalescing, and foreground recovery.
   - Verify every swipe direction still reaches the same navigation action and submits the displayed sentence exactly once.
   - Check build and runtime diagnostics after implementation.

## Files to change

- `src/lib/speech.ts`
- `tests/speech.test.ts`
- `src/hooks/use-orb-mood.ts` only if needed to make mouth animation follow the managed utterance lifecycle instead of a stale browser queue flag

## Out of scope

No new speech provider, generated audio, controls, gesture remapping, visual redesign, or database change.
