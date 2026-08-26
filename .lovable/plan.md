# Restore microphone recording on iPhone

## Confirmed cause

All push-to-transcribe controls share `startPcmRecorder()` in `src/lib/audio-recorder.ts`, so the center long-press and every red dictation button fail through the same path.

The failure is an audio-session conflict, not a transcription or permission problem:

- The speech system explicitly sets the iPhone page audio session to `ambient` in `src/lib/audio-session.ts` so generated speech can mix with music.
- Foreground recovery sets `ambient` immediately and schedules two more writes at 300 ms and 1 second.
- The recorder calls `getUserMedia()` without first releasing that explicit playback-only/mixable session.
- Current WebKit behavior requires the page to be microphone-compatible (`play-and-record` or browser-managed `auto`) before audio capture. WebKit documents that explicitly forcing an incompatible session can make `getUserMedia()` reject with `InvalidStateError` rather than prompt or open the microphone.
- The current retry loop repeats the same request while the session remains incompatible. A delayed foreground retry can also write `ambient` again while microphone startup is underway, so all three attempts can fail identically and produce the permanent “interrupted by iOS” toast.

This matches the reported behavior: Mac works because this audio-session API path is iPhone-specific; all iPhone recording entry points fail because they share the same recorder; and waiting/retrying cannot recover because the conflicting category is reapplied by app code.

Relevant platform evidence:

- WebKit/W3C Audio Session issue 46: explicitly setting a playback session can prevent microphone access and produce `InvalidStateError`.
- W3C Audio Session issue 3: microphone capture requires a `play-and-record`-compatible session rather than `ambient`.
- WebKit's current microphone interruption tests and audio-session work confirm this handoff is actively managed by WebKit on iOS.

## Fix

1. **Give recording explicit ownership of the iPhone audio session**
   - Add a recording-session helper in `src/lib/audio-session.ts`.
   - Immediately before `getUserMedia()`, cancel any pending mixable-session retry timers and switch from `ambient` to `play-and-record`; fall back to `auto` if the iPhone/WebKit build does not accept it.
   - Keep this iOS-only; desktop recording remains unchanged.

2. **Stop playback recovery from interrupting microphone startup**
   - Make delayed mixable-session assertions cancellable and generation-safe.
   - While microphone acquisition or recording is active, prevent foreground/speech recovery timers from changing the session back to `ambient`.
   - `cancelSpeech()` will still stop audio, but microphone startup—not speech cleanup—will own the category transition.

3. **Use a clean, single iPhone acquisition path**
   - Enter recording mode once, request the microphone, and retry only genuinely transient capture failures.
   - Before a retry, discard dead tracks/context state without flipping the session back to playback.
   - Preserve the existing MediaRecorder fallback only for Web Audio setup failure after `getUserMedia()` succeeds; it cannot fix a session-category rejection before a stream exists.

4. **Restore speech mixing only after recording fully ends**
   - On stop, cancel, failed startup, and release, stop tracks first and then return the page to the existing mixable session.
   - Guard the restore so an old recorder cannot switch the category while a newer microphone request or recording is active.
   - Preserve the current behavior where speech can mix with other audio after dictation.

5. **Improve diagnostics without changing the UI flow**
   - Keep user-facing permission/busy messages accurate.
   - Record bounded, text-free diagnostics for the original exception name/message, audio-session type/state, attempt number, and whether failure occurred during capture or Web Audio setup.
   - Do not turn every `InvalidStateError` into a generic “iOS interruption” without retaining its actual cause internally.

## Verification

- Expand `tests/audio-recorder.test.ts` to cover:
  - recording switches `ambient` to `play-and-record` before `getUserMedia()`;
  - pending ambient retries cannot fire during mic startup/recording;
  - transient retries remain in recording mode;
  - stop/cancel/failure restore mixable mode only after the mic is released;
  - stale cleanup cannot disrupt a newer recording;
  - desktop behavior is unchanged.
- Run focused recorder and speech tests, then check build/runtime diagnostics.
- Device verification on the iPhone 16e:
  - center long-press starts and stops repeatedly;
  - red dictation buttons work in chat, New Idea, editor, and media redo;
  - record immediately after spoken playback and after returning from another app;
  - after recording, generated speech still works and mixes with other audio.

## Files

- `src/lib/audio-session.ts`
- `src/lib/audio-recorder.ts`
- `tests/audio-recorder.test.ts`
- `tests/speech.test.ts` only if the shared session ownership contract needs coverage

## Scope

No UI redesign, no gesture changes, no transcription-model change, and no backend/database work. This only repairs the iPhone audio-session handoff between speech playback and microphone capture.
