# Speech on speaker + music mixing on iPhone

## What's actually wrong

Two symptoms, one root family: the iOS **audio session state** and who owns it when a sentence is spoken.

1. **Only audible through AirPods.** Every recording (orb long-press, dictate buttons) opens the microphone, which forces iOS into "recording mode". In that mode the iPhone routes all output to the earpiece — or to AirPods if they're connected. We do release the mic when recording stops, but the teardown is asynchronous: the audio context closes on a timer only WebKit controls. If a swipe happens while that teardown is still in flight — or a recording was ever left half-open — the sentence is spoken into the recording route. Result: silence on the speaker, voice in the AirPods. Speech itself never re-asserts the audio category before it talks, so it inherits whatever state the mic left behind.

2. **Other audio still stops.** Same cause. The moment the microphone opens, iOS interrupts YouTube Music, and iOS does not automatically restart other apps' audio afterward — so even a short recording feels like "Orby killed my music". On top of that, if the audio category is anything but mixable at the instant `speak()` runs, WebKit's speech engine grabs an exclusive session and stops the music again.

One honest limitation: true "ducking" (lowering music volume while speech plays, then restoring) is a native iOS capability that web apps cannot request directly. What we *can* restore is the old behavior you remember: **music keeps playing underneath while Orby talks over it** (mixing), and when music is already playing, iOS itself naturally drops it slightly during spoken audio. The guarantee we're building toward: music never *stops*, speech is always audible on speaker or AirPods, and swipes stay instant.

## The fix

1. **Speech asserts the mixable category itself.** Right before every `speak()` call, synchronously set the mixable audio category (`ambient`). Setting one property is instant — this is not the slow "silent audio anchor" we removed, it's a no-op assignment that guarantees speech never inherits a leftover recording/exclusive state. Also re-assert once more when the utterance actually starts, to catch any late teardown flip.

2. **Speech waits for a dying microphone, never for a live one.** If a swipe fires while mic teardown from a just-finished recording is still closing, speech stops the mic tracks synchronously (instant) and asserts the mixable category, so output can only route to speaker/AirPods. No silent anchors, no media playback — just deterministic session state.

3. **Make mic teardown airtight.** Every recording stop path (orb long-press toggle, dictate stop, cancel, screen leave, hands-free call end) fully stops tracks and closes the context, and a superseded microphone request can never resurrect a stream after the fact. The warm-mic optimization stays *only while a recording is genuinely active* — never held open between sessions.

4. **Keep swipe speed untouched.** Cancel-then-speak still happens in the same tick as the swipe. All session work is synchronous property assignment and track stops — zero added latency.

5. **Tests + build verification.** Update the speech/audio tests to assert: mixable category is set at speak time and on utterance start, no exclusive category is ever requested, no audio element is created, and speech cannot start while a recording context is still open.

## Note on the silent switch

A mixable category means iOS treats Orby's voice like music apps do: if your ring/silent switch is on, speaker speech can be muted (AirPods still work). That's the required trade for music to keep playing — iOS gives web apps "mixes with other audio" **or** "plays while silenced", never both. Mixing is the behavior you described as correct.

## Device check for you after it ships

Hard-refresh the app once (to be sure you're on the new build), then: play YouTube Music → swipe sentences → music keeps playing and Orby talks over it on the speaker; connect AirPods → voice moves to AirPods, music stays; record a long-press note → after stopping, music is still there and the next swipe speaks on the speaker.

## Files

- `src/lib/speech.ts` — assert mixable category at speak/start; await any in-flight mic teardown before submitting
- `src/lib/audio-session.ts` — small helper additions if needed (e.g. "ensure mixable" + teardown coordination)
- `src/lib/audio-recorder.ts` — expose teardown state so speech can sync with it; tighten stop paths
- `src/lib/use-voice-dictation.ts`, `src/routes/_authenticated/app.tsx` — verify every stop path releases the mic
- `tests/speech.test.ts`, `tests/audio-recorder.test.ts` — updated assertions

## Out of scope

Voices, gesture mapping, visuals, backend. True volume ducking is not available to web apps on iOS — we deliver uninterrupted mixing instead.
