# Fix iPhone microphone recording and stop text-to-speech from dying

## Root causes found (from reading the code)

### Microphone — "Microphone access is needed to record"

All red record buttons (chat composer, media dialogs, redo composer) and the orb long-press go through one shared recorder (`src/lib/audio-recorder.ts` → `startPcmRecorder`). Three weaknesses explain the failure:

1. **A new `AudioContext` is created on every cold recording start.** iOS has a low hardware limit on live audio contexts, and closing them is asynchronous and slow. After several record/stop cycles (plus the speech engine's own context), iOS starts refusing new ones and `getUserMedia`/context creation throws — the only recovery today is an app restart.
2. **No retry on a transient `getUserMedia` failure.** On iOS the mic request is rejected if the mic was just released (by us, by a phone call, or by another app moments earlier). One bad timing window = instant failure toast.
3. **Every failure shows the same toast.** "Microphone access is needed to record" is shown for *every* error, even when the real cause is the mic being busy in another app or a transient rejection — so a fixable situation looks like a permissions problem.

Separately, the transcription step (`src/lib/whisper.functions.ts`) calls OpenAI directly with an `OPENAI_API_KEY` secret and model `gpt-4o-transcribe`. The user remembers it as "GPT-4o mini". Moving it to Lovable AI's `openai/gpt-4o-mini-transcribe` removes the secret dependency (it fails hard if that key is ever missing) and matches the remembered model.

### Text-to-speech — works, then dies until the app is restarted

1. **The playback `AudioContext` is only recreated when its state is `"closed"`.** On iOS, when another app uses the microphone (or a call comes in, or the phone sleeps), the context is left in an interrupted/suspended state that `resume()` often cannot recover from. Our code calls `resume()` but keeps the broken context forever — every subsequent sentence schedules audio into a dead engine. Silence until reload.
2. **No watchdog.** If a sentence never starts playing, nothing notices: no error, no reset, `isSpeaking` can stay wedged.
3. **A stale cached sign-in token is never retried.** The client caches the token; once it expires in a bad window, every swipe gets a 401 "session expired" with no refresh-and-retry — again fixed only by reload.
4. **No retry for transient gateway failures.** The "service unavailable"-style error the user saw is the route's 502 catch-all; 429/5xx responses are retriable per the AI gateway contract but we surface them immediately with no single bounded retry.

## The fix

### Part 1 — Microphone

1. **Reuse one recorder `AudioContext`.** Keep a single context for the recorder's lifetime; only recreate it if it was closed. This removes the iOS context-exhaustion failure mode entirely.
2. **Retry once on mic acquisition failure.** If `getUserMedia` throws, fully release any held mic, wait ~300 ms, and try one more time before showing an error. Handles the "mic just released by another app" window.
3. **Detect dead warm streams.** Listen for track `ended`/`mute` events and immediately invalidate the cached warm stream so the next press re-acquires cleanly instead of recording silence.
4. **Accurate error toasts.** Map the error name to the message: permission denied → "Microphone permission is off — enable it for this app in Settings"; mic busy → "The microphone is busy in another app — close it and try again"; anything else → generic retry message. Applies everywhere since all buttons share `useVoiceDictation`.
5. **Switch transcription to Lovable AI** (`openai/gpt-4o-mini-transcribe`, the model the user remembers). Server-side call via the speech-to-text endpoint with the built-in key — no `OPENAI_API_KEY` secret to manage. Streaming is unnecessary for short push-to-talk clips; use the default buffered JSON response.

### Part 2 — Text-to-speech that can't get stuck

1. **Recreate a broken playback context, don't just resume it.** At speak time, if the context state is not `"running"` and a `resume()` does not reach `"running"`, discard it and create a fresh one (also treat iOS's interrupted state as broken). Because swipes are user gestures, the new context starts immediately.
2. **Foreground recovery.** On `pageshow`/`visibilitychange` back to the foreground, proactively resume-or-recreate the playback context so the first swipe after using the mic in another app just works.
3. **Startup watchdog.** If ~1.5 s after a speak call no audio chunk has started and no error fired, reset the speech state and surface a "Speech couldn't start — try again" toast instead of hanging silently.
4. **Token self-healing.** On a 401 from the speech route, clear the cached token, force a session refresh, and retry the request once. A stale token can no longer wedge speech until reload.
5. **One bounded retry on 429/5xx** (honoring `Retry-After` when present, otherwise ~1 s backoff), per the AI gateway retry contract. Terminal 4xx errors still surface immediately with their real message.

## Files

- `src/lib/audio-recorder.ts` — shared context, retry, dead-stream detection
- `src/lib/use-voice-dictation.ts` — accurate per-cause error toasts
- `src/lib/whisper.functions.ts` — transcribe via Lovable AI `openai/gpt-4o-mini-transcribe`
- `src/lib/speech.ts` — context recreation, watchdog, token refresh-retry, bounded 429/5xx retry, foreground recovery
- `tests/speech.test.ts`, `tests/audio-recorder.test.ts` — cover the new recovery paths

## Verification

- Run the focused speech/recorder tests and check the build log.
- Live preview sanity: record in chat, speak sentences, force-error paths show the right toasts.
- Device check on iPhone: record in chat repeatedly; use the mic in another app, return, and swipe — speech works without restarting the app.

## Out of scope

No UI changes, no voice list changes, no gesture changes, no changes to the legacy realtime voice call path.
