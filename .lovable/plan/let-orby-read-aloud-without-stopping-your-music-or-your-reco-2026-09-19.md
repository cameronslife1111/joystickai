# Let Orby read aloud without stopping your music or your recording

Reading aloud stays on your phone's own free built-in voice. What changes is how the app claims the phone's audio, so music keeps playing and a Voice Memo keeps recording while Orby speaks.

## What's actually causing it

Two separate things, both confirmed in the code:

- **Music stops:** the app currently asks for no audio mode at all when it speaks, which means the phone falls back to whatever mode was last set. After any recording, that's the exclusive record-and-play mode, and a page speaking in that mode takes the audio over from other apps.
- **Your Voice Memo stops:** the app keeps the microphone warm between recordings and, right before every sentence, hands the microphone back. On iPhone the microphone is exclusive, so holding or grabbing it is enough to kill another app's recording, even when Orby isn't recording.

## The fix

1. Before speaking, explicitly ask the phone for the **shared ("ambient") audio mode** — the one mode iOS treats as "mix with other apps" — instead of leaving whatever mode a past recording left behind. Speech still comes entirely from the device voice.
2. Stop touching the microphone in the reading-aloud path. Reading a sentence will no longer stop, warm, or hand back the microphone in any way.
3. Stop keeping the microphone warm after a recording finishes: release it fully the moment a recording ends, so another app can record freely while you use Orby.
4. Keep the record-and-play mode strictly inside an actual recording (red circle, voice typing, live call), and return the phone to the shared mode as soon as it ends.
5. Keep the existing recovery that makes the next press work after app switching, but without re-grabbing audio.

## One honest trade-off

The shared mode is the only mode iOS lets a web page mix with other apps — and it is also the mode the ring/silent switch mutes. So with this change, if your phone's side switch is set to silent, reading aloud will be silent. The mode that ignores the silent switch is the same one that stops your music; iPhone gives a web page no way to have both. If you'd rather keep ignoring the silent switch, say so and I'll leave it loud-but-exclusive instead.

## Checks on your iPhone

- Play YouTube Music, then read sentences: music should keep playing under Orby's voice.
- Start a Voice Memo, come back to Orby, press to read: the memo should keep recording.
- Record in Orby, stop, then read a sentence right away: it should speak.
- Ring switch off silent, read a sentence: it should speak.
- Repeat once with AirPods.

## Technical scope

- `src/lib/audio-session.ts`: add a mixable-ambient request used before speaking; keep recording begin/end, and have release return to ambient rather than leaving a record category in place.
- `src/lib/speech.ts`: drop the `stopMicForPlayback()` call and any mic coupling; request ambient before submitting an utterance; keep gesture priming, stale-queue reset and the watchdog.
- `src/lib/audio-recorder.ts`: fully release the mic stream when recording ends instead of keeping it warm; remove `stopMicForPlayback`.
- `tests/speech.test.ts`, `tests/audio-recorder.test.ts`: speech requests ambient only, touches no microphone; recording claims and fully releases mic and category.

## Out of scope

Voices, speech speed, gestures, visuals, backend, hosted text-to-speech.
