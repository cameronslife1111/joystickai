# Make sentence reading truly the device's own voice again

🏆 Let's stop overriding the iPhone's audio behavior entirely, so reading aloud works with the ring/silent switch either way, layers over your music instead of stopping it, and survives using the microphone.

## What the research shows

- On iPhone, a web page's audio session defaults to the `ambient` category, and `ambient` is exactly the category the ring/silent switch mutes. [4](https://blog.lans.cloud/ios-silent-switch-web-audio)
- The categories that keep playing with the switch on are `playback` and `play-and-record` — but `playback` is the exclusive one that stops other apps' audio. [5](https://github.com/moeru-ai/airi/pull/2075)
- The Audio Session type is only a request; the platform decides how page audio coexists with other apps. [6](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession)

So the current setup is self-defeating: Orby explicitly asks for `ambient`/`transient` before every sentence, which is what makes the ring switch silence it — and the earlier version that ignored the switch never set anything at all. The device's built-in speech engine has its own audio handling that already mixes and ducks; our overrides are what pushed sentence speech onto the ring-switch channel.

Nothing is rendered, downloaded, or played as a file — sentences already go straight through the device's built-in speech engine. That stays true.

## Go To Format

1. Go to the sentence-speech path and remove every audio-session request around reading a sentence: no category before speaking, none on start, none on finish, error, or cancel. Let the device's own speech engine keep its native session, which is what mixes with music and ignores the ring switch.
2. Go to the microphone boundary and keep the recording category only while Orby is actually recording, then release it back to the untouched default when recording stops instead of forcing a category.
3. Go to the "take the audio back from the microphone" step in the speech path and make it stop only a microphone that is finished or abandoned — never one that is actively recording, and never as a blanket call before every sentence.
4. Go to the after-recording path and make the first sentence press afterwards clear the stale speech queue and resubmit once in the same press, so speech works immediately after using the red circle instead of going silent.
5. Go to the app-return recovery and keep the existing queue reset, but drop its audio-session reassertion, so returning from another app never re-mutes speech.
6. Go to the speech and recorder tests and prove that reading a sentence requests no audio-session category at all, creates no audio element, and that recording still claims and releases its own category cleanly.
7. Go to the tests, build log, and browser errors and verify them, then do the iPhone checks below — cross-app audio policy cannot be reproduced on a desktop browser.

## iPhone checks for you

- Ring switch on silent: press to read a sentence — it should speak.
- Play YouTube Music, then read sentences: music should keep playing underneath.
- Record with the red circle, stop, then read a sentence right away: it should speak.
- Start a Voice Memo, come back, and read a sentence.
- Switch to another audio app and back, then read one sentence.
- Repeat once with AirPods connected.

## If a category still turns out to be required

If reading aloud goes silent on your device with no category set, the fallback is `playback` — that one ignores the ring switch, at the cost of pausing other apps' audio. I'll only take that trade if your device test shows the no-category version doesn't speak, and I'll tell you plainly rather than switching quietly. Orby will never go back to a looping silent audio clip or a hosted voice file.

## Technical scope

- `src/lib/audio-session.ts`: drop the speech-session helpers and the mixable retry loop; keep only recording begin/end plus the interruption listener.
- `src/lib/speech.ts`: remove all session calls; narrow the mic hand-back; keep gesture priming, the stale-queue reset, and the watchdog.
- `src/lib/audio-recorder.ts`: own the recording category and release it without forcing a replacement.
- `tests/speech.test.ts`, `tests/audio-recorder.test.ts`: assert no category is requested during speech, and recording lifecycle coverage.

## Out of scope

Voices, speech speed, gestures, visuals, backend, hosted text-to-speech.
