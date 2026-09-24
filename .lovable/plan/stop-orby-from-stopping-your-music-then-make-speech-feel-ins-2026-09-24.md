# Stop Orby from stopping your music, then make speech feel instant

## Part 1 (the urgent one): opening or leaving Orby stops your music and recordings

### What the code does today
- Every tap or key press anywhere in Orby starts up the speech audio player, even when nothing is being spoken. On iPhone (Chrome runs on the same Safari engine) this is the moment the phone decides "this page wants audio," and it can pause other apps.
- The player is created at a fixed low quality (24 kHz) instead of the phone's own rate. Asking iPhone for a different rate can force it to reconfigure the audio system, which interrupts whatever is playing.
- Each time you leave Orby, the player is shut down, and it is rebuilt on the next tap. So both leaving and coming back touch the phone's audio.
- The shared ("mix with others") mode is only requested when `navigator.audioSession` exists; if Chrome on iOS doesn't expose it, nothing asks for mixing at all.

Which of these is the exact trigger on your phone is not confirmed yet (I can't test on your iPhone from here), so the fix removes all of them.

### The fix
1. Remove the "start audio on every tap" listener. Nothing audio-related happens on page open, on taps, or on leaving.
2. Create the audio player only when a sentence is actually about to be read, at the phone's own rate (the 24 kHz voice is converted inside the player, so no hardware reconfiguration).
3. Ask for the shared mode right before creating/resuming the player, every time.
4. On leaving Orby: just stop the sentence and quietly pause the player. Don't close, rebuild, or re-request anything. On return: do nothing until you press to read.
5. After a sentence finishes, pause the player after a short idle (about 2 seconds), so Orby isn't holding audio while you use other apps.
6. Add a small hidden check (visible in logs) that records which audio mode the phone reports, so if it still interrupts on your phone we'll know exactly why next round.

Honest limit: when Orby is actively speaking, iPhone decides whether music mixes or pauses. These changes stop Orby from grabbing audio when it is *not* speaking, which is what you're describing.

## Part 2: preload so speech starts faster

1. **Next 3 sentences:** when you land on a sentence, Orby quietly fetches the voice for the next 3 sentences in the background, one at a time, after the current one has started. They're stored ready to play.
2. **Green button targets:** for every document in your favorites cycle, Orby preloads the sentence you'd land on when the green button jumps there (the next target first, then the rest of the cycle).
3. Moving on cancels preloads you no longer need. Preload failures stay silent and never show "Speech error."
4. Preloading is off when Sound is off, during a call, or while recording.
5. The ready-to-play store grows from 30 to about 80 sentences so preloaded ones aren't pushed out.

Cost note: preloading generates speech for some sentences you might skip. With 3 ahead plus your favorites, that's usually a small amount; tell me if you'd prefer fewer.

## Technical details
- `src/lib/speech.ts`: remove the global pointerdown/touchend/keydown unlock; lazy `AudioContext` with default sample rate (buffers stay 24 kHz); `requestIosMixableSession()` before create/resume; `pagehide`/hidden → `stopStream()` + `ctx.suspend()` (no close); idle suspend timer; add `prewarmSpeech(text)` with a serial queue and its own AbortController that fills the cache without playing; `cancelPrewarm()` implemented; CACHE_MAX → 80; debug log of `audioSession.type/state`.
- `src/routes/_authenticated/app.tsx`: effect keyed on active doc + current index that prewarms the next 3 sentences, then the landing sentence of `nextDocTargetId` and every other favorite doc (using the cached sentence lists and saved index, same as the green-button fast path). Gated by muted/in-call/recording.
- `tests/speech.test.ts`: no audio context created before the first speak, no close on hide, prewarm fills cache without playing and never cancels live speech.

## Checks on your iPhone (Chrome)
- Play YouTube Music, open Orby, tap around without reading: music keeps playing.
- Leave Orby and come back: music keeps playing.
- Start a Voice Memo, open Orby, tap around: memo keeps recording.
- Flip through sentences and press green: speech starts noticeably faster.
