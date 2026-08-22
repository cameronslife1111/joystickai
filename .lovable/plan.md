# Clean up iPhone speech: kill the lag and make every swipe cancel instantly

Native speech now works on the iPhone. What remains is that the iPhone path in `src/lib/speech.ts` carries several safety mechanisms that the Mac path skips, and each one costs time or drops a sentence. The plan removes that extra machinery now that the route anchor has proven to be the thing that actually mattered.

## What the code does differently on iPhone today

Confirmed by reading `src/lib/speech.ts`:

- Sentences are split into 170-character chunks and spoken one at a time, with the next chunk only submitted from the previous chunk's `end` event. Each hand-off adds a pause, and a swipe mid-sentence has to unwind a chunk queue.
- Replacing active speech never speaks in the same tick: it cancels, then polls up to 30 times at 16 ms (about half a second) waiting for `speaking`/`pending` to clear before submitting.
- Every gesture start (`prepareSpeechGesture`) calls `releaseMic()`, re-requests the playback session, starts the route anchor, and cancels any running speech — so a swipe pays for a full teardown before speaking.
- A 900 ms watchdog can re-submit the utterance, and iPhone has an extra "explicit voice retry" path that submits a second utterance with a resolved voice.
- `cancelSpeech` holds cancelled utterance objects for 500 ms and stops the route anchor, which the next swipe then restarts.

Together these explain both symptoms: the delay before speech starts, and swipes that appear not to speak at all (a swipe landing inside the poll/watchdog window gets its utterance superseded or dropped).

## The fix

1. **Speak the whole sentence as one utterance on iPhone.** Drop chunking for normal sentence lengths (keep it only as a guard for very long text, at a much higher threshold), so there are no inter-chunk gaps and cancellation has one object to kill.
2. **Cancel and speak in the same gesture tick.** Replace the poll-until-idle path with: `cancel()` then submit immediately in the same tick on iPhone, since that is what preserves user activation and is what makes the Mac feel instant. Keep the existing short settle path only as a fallback if a same-tick submit is observed to not start.
3. **Make the route anchor persistent instead of per-utterance.** Start it once on first gesture and keep it playing while the app is foregrounded; stop it only on page hide/visibility change. This removes start/stop churn on every swipe and every chunk, and removes the reason for the 250 ms post-gesture cleanup timer.
4. **Slim down the gesture prologue.** `prepareSpeechGesture` stops calling `releaseMic()` and stops cancelling on every pointerdown; it only ensures the playback session and anchor are live. Cancellation happens once, at the moment the new sentence is submitted, so the newest swipe always wins.
5. **Tighten the watchdogs.** Reduce the silent-drop watchdog from 900 ms to a short window, remove the duplicated explicit-voice retry on iPhone (keep one recovery attempt total), and drop the 500 ms cancelled-utterance retention that keeps stale objects alive across swipes.
6. **Drive the mouth from actual speech state.** Keep `isSpeaking()` semantics, but set it on `start` as well as `boundary` so the animation matches a single-utterance sentence.

## Verification

- Update and run the focused speech tests: rapid successive swipes cancel the previous sentence and speak only the newest; a long sentence is one utterance; the route anchor is started once and not stopped between sentences; cancellation and page-hide still stop audio.
- Check the build log and browser runtime errors.
- Device check by you: swipe up/down/left/right quickly in a row on the iPhone and confirm each swipe cuts the previous sentence off immediately and starts the new one without a pause, and that desktop Chrome behavior is unchanged.

## Files to change

- `src/lib/speech.ts`
- `tests/speech.test.ts`
- `src/lib/audio-session.ts` only if a small lifecycle helper is needed

## Out of scope

No hosted or generated voices, no new buttons, no gesture remapping, no visual changes, no database changes. The iPhone's own speech engine stays the voice.
