# Fix speech: restore true native voice behavior (duck music, ignore silent switch)

## Diagnosis (verified in code)

The speech path itself is already pure browser speech: `src/lib/speech.ts` calls `window.speechSynthesis.speak()` directly with no audio files, no hosted voice, no mic involvement. The regression comes from what surrounds it:

1. **`src/lib/audio-session.ts` pins the page to the `ambient` audio category.** It is called from `src/lib/use-realtime-voice.ts` (line 69) every time a hands-free voice session ends, and it is never reset. On iOS, `ambient` **respects the Ring/Silent switch** — that is exactly why speech goes silent when the phone is on silent mode.
2. **Microphone capture and WebRTC calls switch iOS into call/recording mode**, which pauses background music (Music/YouTube). `src/lib/audio-recorder.ts` and the realtime voice teardown stop tracks but **never return the audio session to its default state**, so the phone stays in the wrong mode and music never comes back — it sounds like "the app stops all my audio."
3. The behavior the user remembers (speech ducks music and plays even in silent mode) is what iOS gives `speechSynthesis` when the page leaves the audio session at its **default (`auto`)** state. We need to stop overriding it and always restore it.

## Fix

1. **Rework `src/lib/audio-session.ts`**
   - Replace `requestIosMixableSession()` (which prefers `ambient`) with `restoreDefaultAudioSession()` that sets `navigator.audioSession.type = "auto"` — the untouched default that produced the original duck-and-ignore-silent-switch behavior.
   - Keep it iOS-only and feature-detected; other browsers/platforms are never touched.
   - Never request `ambient` (silent-switch blocking) or `playback` (exclusive, kills other audio) anywhere.

2. **Restore the default session after every mic/WebRTC use**
   - `src/lib/use-realtime-voice.ts`: after a hands-free call fully tears down (tracks stopped, audio element removed), call `restoreDefaultAudioSession()` instead of the mixable/ambient call.
   - `src/lib/audio-recorder.ts`: at the end of `releaseMic()` (already called after every recording stop/cancel), restore the default session so dictation and orb long-press recording can't leave the phone in recording mode.

3. **Leave the speech engine pure**
   - `src/lib/speech.ts` stays exactly as it is: one native `SpeechSynthesisUtterance` per sentence, browser-default voice, cancel-then-speak. No audio-session, mic, or routing logic in the speech path.
   - All six orb buttons, chat read-aloud, and mute keep calling `speakText`/`cancelSpeech` unchanged.

4. **Tests**
   - Update `tests/audio-recorder.test.ts` / add coverage: `releaseMic()` restores the default audio session; the realtime teardown restores it; no code path requests `ambient` or `playback`.
   - Run the speech and recorder test suites and check build diagnostics.

## Files to change

- `src/lib/audio-session.ts`
- `src/lib/use-realtime-voice.ts`
- `src/lib/audio-recorder.ts`
- `tests/audio-recorder.test.ts` (and a small session test)

## Out of scope

No changes to the orb buttons, gesture mapping, sentence navigation, chat, or the speech wrapper's public API. No new dependencies.

## Verification note

Music ducking and the silent switch can only be confirmed on a real iPhone: after this ships, play music in Safari/YouTube, press an orb with the phone on silent — Orby should talk, the music should dip and come back. I'll flag if anything in the desktop verification suggests otherwise.
