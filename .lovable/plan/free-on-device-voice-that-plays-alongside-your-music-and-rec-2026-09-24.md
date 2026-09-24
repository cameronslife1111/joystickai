# Free on-device voice that plays alongside your music and recordings

## The honest core finding

The iPhone's built-in voice (the one Orby uses now) can't be "loaded like an API." A web page can only tell it "speak this." It never gets the sound back as audio, so iOS decides how that voice mixes, and that's why it sometimes stops your music or Voice Memo.

Gemini worked because Orby received real audio and played it itself, with a shared, mixable audio mode. To get that same behavior for free, the voice has to be made **on your phone, inside Orby**, instead of on Google's servers.

## The approach

Run a small, free, open-source voice model directly in the browser on your iPhone (Kokoro, with Piper as the backup choice). It turns each sentence into real audio on the device: no internet per sentence, no credits, no API key. Orby then plays that audio through the same mixable path Gemini used.

- Music, YouTube and Voice Memos keep running while Orby reads.
- Nothing is sent anywhere, and it costs nothing per sentence.
- It works the same on iPhone, Android and computers.

## What you'll notice

- **First time only:** the voice downloads once (about 80 MB) and is then saved on the phone. While it downloads, Orby keeps using the current built-in voice so reading never stops working.
- **Speed:** each sentence takes a moment to create. Because it's free, Orby will quietly prepare the next few sentences ahead of time, so swiping still feels instant. Your current reading speed stays the same.
- **Voices:** a few natural English voices, chosen in the Sound popup (Slot 4).
- **Silent switch:** the mixable mode is the one iOS mutes when the side switch is on silent. That's the same trade-off Gemini had.

## Steps

1. Add the on-device voice engine. It runs in a background worker so the screen never freezes, and it downloads and saves the voice once.
2. Rebuild the reading path so it makes audio for the sentence, then plays it with the same mixable setup Gemini had. Keep "newest swipe wins," Sound off, Repeat, chat read-aloud and Orby's mouth animation.
3. Prepare the next 2–3 sentences ahead of time and keep recent ones for instant Repeat.
4. Use the current built-in voice as a fallback until the download finishes, or if the phone can't run the model.
5. Add voice choice back to the Sound popup and remember it per account.
6. Test on your iPhone with YouTube Music, a Voice Memo, app switching, AirPods, and swiping fast.

## Technical details

- Engine: `kokoro-js` (ONNX, WebGPU with WASM fallback, q8 model), with Piper WASM as an alternative if iOS performance is poor. Runs in a Web Worker and is cached in Cache Storage/OPFS.
- Playback: 24 kHz PCM goes into a shared `AudioContext` that is resumed on the user's press. Set `navigator.audioSession.type = "ambient"` (mixable) before play and never use `playback`/`transient-solo`. Resume the context after `pageshow`/`visibilitychange`.
- Rework `src/lib/speech.ts` behind the same public API (`speakText`, `cancelSpeech`, `isSpeaking`, etc.). Add a `tts-local` worker module and an LRU clip cache keyed by text and voice. Prefetch runs from `app.tsx`.
- `SoundSettingsDialog` gets its voice list back. Voice choice uses the existing unused `user_preferences.tts_voice` column, so no migration is needed.
- The native `speechSynthesis` code stays only as the fallback.
- Tests: generation is mocked, and they cover single playback, cancel-then-replace, sound-off silence, the ambient session, and the fallback.

## Out of scope

No paid services, no changes to recording, hands-free calls, gestures or layout.
