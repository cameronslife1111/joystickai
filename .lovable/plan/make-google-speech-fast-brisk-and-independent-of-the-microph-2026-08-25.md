# Make Google speech fast, brisk, and independent of the microphone

## What's actually wrong (4 things)

1. **~1–2s startup delay.** Every sentence pays three tolls before the first sound: a client-side session lookup, a server-side token verification that makes its own network round-trip to the auth service, and then the Google request itself. On top of that, the Repeat button and the 2-minute auto-repeat pay the full price again — the plan called for a speech cache, but none was ever built, so replays re-generate and re-download everything.

2. **Speech rate is the model default.** We send the sentence to Google with no pacing instruction and play the returned audio at exactly 1.0x, so every voice reads at a slow, draggy pace.

3. **Using the mic breaks speech.** After any recording (orb long-press, dictate buttons), iOS leaves the phone's audio session in "recording mode". Our speech code never re-asserts the mixable audio category before playing (the helper exists but speech never calls it), so the streamed audio plays into the wrong route — silent on speaker — until the app is reloaded. Speech isn't tied to the mic by design; it just never takes the audio session back after the mic borrowed it.

4. **Other audio gets stopped, not mixed.** Same root cause as #3: without the mixable category asserted at the moment audio starts, iOS treats our playback as exclusive and pauses YouTube Music etc.

## The fixes

### 1. Cut the startup delay
- **Cache the sign-in token on the client.** Read the token once, keep it with its expiry, and only re-fetch when it's near expiry — removes a storage round-trip from every sentence.
- **Cache token verification on the server** for ~60 seconds per token, so the TTS route skips its network call to the auth service on rapid consecutive sentences (the swipe-through case). Verification still happens; it just isn't repeated every second.
- **Add the missing replay cache.** Keep the decoded audio for the last ~12 spoken sentences in memory, keyed by cleaned text + voice. Repeat and auto-repeat then start instantly with zero network and zero extra AI credits. No speculative pre-generation — only sentences the user already heard are cached.

### 2. Speed up all voices
- Play every scheduled audio chunk at a slightly raised rate (~1.15x, one tunable constant) in the Web Audio player. This applies uniformly to all four voices, is instant, and needs no per-voice tuning. At 1.15x the pitch lift is barely perceptible but the pace stops dragging.

### 3. Free speech from the microphone
- **Speech takes the audio session back itself.** Right before every speak call (synchronously) and again when the first audio chunk actually starts, assert the mixable iOS audio category (`ambient`). This is a property assignment, not media playback — zero added latency — and it guarantees speech never inherits the leftover recording state.
- **Speech never waits on a dying mic.** If mic teardown from a just-finished recording is still in flight, speech synchronously stops the mic tracks first, then plays. No added delay.
- **Recover a stuck playback engine.** If the Web Audio context was suspended or interrupted while the mic was open (iOS does this), resume it — and recreate it if it was closed — before scheduling audio.

### 4. Mix with other audio instead of stopping it
- The `ambient` category from fix #3 is exactly what makes iOS mix our speech over other apps' audio: music keeps playing underneath, and iOS naturally drops it slightly while spoken audio plays. 
- One honest limit, unchanged from before: true volume "ducking" is a native-iOS capability web apps can't request — mixing (music never stops) is what we deliver. Trade-off: with the mixable category, the ring/silent switch can mute speaker speech (AirPods still work). That's the price of not killing your music.

## Files

- `src/lib/speech.ts` — token caching, replay cache, 1.15x playback rate, mixable-category assert at speak + first-chunk time, playback-context recovery, mic-teardown sync.
- `src/lib/audio-recorder.ts` — expose mic teardown state so speech can stop tracks synchronously when needed (small addition; recording behavior unchanged).
- `src/routes/api/public/tts.ts` — short-lived token-verification cache (bounded size, ~60s TTL).
- `src/lib/audio-session.ts` — reuse `requestIosMixableSession`; no rewrite expected.
- `tests/speech.test.ts` — cover: mixable category asserted at speak time, playback rate applied, replay cache hits skip the network, no audio element/exclusive category ever used, speech proceeds even if mic teardown is in flight.

## Verification

- Run the focused tests and check build/runtime logs.
- Live preview: swipe through sentences rapidly — newest sentence starts without overlap, repeats replay instantly, gateway errors still toast.
- Your device check on iPhone: (a) first sentence after opening the app starts noticeably faster; (b) every voice reads slightly faster but naturally; (c) record a long-press note, then swipe — speech works immediately on the speaker; (d) play YouTube Music, swipe — music keeps playing under Orby's voice.

## Out of scope

Voice list, UI, gesture mapping, sentence navigation, backend model choice. No return to device speech synthesis.
