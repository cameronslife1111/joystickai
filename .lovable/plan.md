# Fix hands-free mode on iPhone and run it on the cheaper voice model

## The iPhone error

The red "audio session category is not compatible with audio capture" message is confirmed in the code, not a device problem.

Speech playback deliberately puts the iPhone page audio session into the mixable `ambient` category so Orby can talk over music. `src/lib/audio-session.ts` already has a recording-ownership helper (`beginIosRecordingSession` / `endIosRecordingSession`) that flips iOS to `play-and-record` before the microphone opens — and the push-to-talk recorder uses it. The hands-free call does not: `src/lib/use-realtime-voice.ts` calls `getUserMedia()` directly while the session is still `ambient`, so iOS rejects capture with exactly that message. It also calls `requestIosMixableSession()` on stop without ever having taken ownership, so pending playback timers can flip the category back mid-connect.

### Fix

- Take the recording session before requesting the microphone in `use-realtime-voice.ts`: call `beginIosRecordingSession()` first, keep the returned token, and release it with `endIosRecordingSession(token)` in `stop()` (and on a failed start).
- Because a live call both records and plays audio, keep the session in `play-and-record` for the whole call — no mixable re-assert while the call is live.
- Add a small retry: if the very first `getUserMedia()` fails with a category/state error, re-assert the recording session once and try again, so a call started immediately after Orby finished speaking still connects.
- Only restore the mixable/ambient category once the call is fully torn down and the mic tracks are stopped, so normal speech can still mix with music afterwards.
- Keep permission-denied wording separate from this transient case, and surface a clear, honest toast for anything else.

This is iOS-only behavior; Chrome on iOS uses the same WebKit audio session, so the same fix covers Chrome, Safari, and desktop browsers (where the helper is a no-op).

## Cheaper model for hands-free

There is no "Luna" realtime voice model — `gpt-5.6-luna` is a text chat model and cannot run a live voice call. The cheap equivalent on the voice side is OpenAI's mini realtime model; the current call uses the full-price `gpt-realtime`.

- Switch the hands-free session model in `src/lib/realtime.functions.ts` to `gpt-realtime-2.1-mini` (the current cheap realtime model, confirmed today against OpenAI's model docs), keeping the same `shimmer` American female voice, semantic VAD with barge-in, and input transcription.
- Everything else — chat replies, planning, delegate, media revise — stays on `gpt-5.6-sol`. That already happens automatically: the realtime model is only used while a call is live and typed chat always goes through the sol path, so ending the call returns you to sol with no extra work.
- If the mini model ever rejects the session, the error is surfaced in the toast rather than silently falling back, so a bad model id is obvious.

## Files

- `src/lib/use-realtime-voice.ts` — audio-session ownership around the call
- `src/lib/audio-session.ts` — only if the recording helper needs a "keep for playback+record" variant
- `src/lib/realtime.functions.ts` — realtime model id

## Out of scope

No UI changes, no changes to the chat/planning models, no changes to push-to-talk dictation or speech playback behavior.
