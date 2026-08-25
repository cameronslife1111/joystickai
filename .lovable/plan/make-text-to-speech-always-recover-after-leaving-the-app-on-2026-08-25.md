# Make text-to-speech always recover after leaving the app on iPhone

## Problem

On iPhone, after switching to another app that uses audio (Voice Memos, phone call, music apps), coming back to Orby leaves text-to-speech silent until the app is restarted. The current recovery code in `src/lib/speech.ts` handles a context whose state is `"closed"` or `"interrupted"`, or a `resume()` that fails — but iOS has a worse failure mode it doesn't cover.

## Root causes (confirmed from the code)

1. **The "running but dead" context is never replaced.** After another app grabs the audio hardware, Safari can hand back an `AudioContext` that still reports `state === "running"` but whose clock is frozen and which produces silence. `recoverPlaybackContext()` (speech.ts:161) sees `"running"` and trusts it — audio gets scheduled into a dead engine on every swipe, forever.
2. **Foreground recovery runs outside a user gesture.** `attachForegroundRecovery()` (speech.ts:191) calls `recoverPlaybackContext()` from `pageshow`/`visibilitychange`. iOS only honors `resume()` inside a real tap, so this "recovery" cannot actually revive anything — the heal must happen inside the orb-tap that triggers speech.
3. **`resume()` can hang forever right after an interruption.** The code `await context.resume()` with no timeout; if the promise never settles, the sentence hangs silently until the watchdog error.
4. **The iOS audio session is re-asserted only once.** `reclaimAudioRoute()` sets the mixable category a single time at speak start. Right after returning from an app that recorded audio, iOS may still be transitioning the session and the one-shot assertion silently fails.
5. **The watchdog reports but doesn't heal.** When it fires ("Speech couldn't start"), the next swipe reuses the same suspect context — nothing marks it bad.

## The fix

### 1. Liveness check — never trust a "running" context (speech.ts)
At speak time, treat the context as alive only if its `currentTime` actually advances over a short window (~150 ms). State says "running" but clock frozen → close it and build a fresh one. This kills the permanent-silence failure mode.

### 2. Foreground = fresh engine on next tap (speech.ts)
On `pageshow`, `visibilitychange` → visible, and window `focus`: stop any scheduled sources, close the old context, and mark it stale. Do NOT try to resume there (iOS ignores it outside a gesture). The next orb tap — which IS a user gesture — creates a brand-new context with a guaranteed clean audio route.

### 3. Bounded resume with escalation (speech.ts)
Race each `resume()` against a ~500 ms timeout; retry up to 2 times; if still not running, discard and recreate, then resume the fresh one (inside the tap gesture, so iOS allows it). A hung resume can no longer wedge a sentence.

### 4. Re-assert the mixable audio session with retries (audio-session.ts + speech.ts)
Add a helper that re-sets the `ambient` (mixable) category immediately and again at ~300 ms and ~1 s — winning the category back from whatever app just released it. Run it on every foreground return and keep the existing per-speak assertion.

### 5. `statechange` listener (speech.ts)
If the context drops out of `"running"` while the app is visible (interruption arrives while we're looking at it), mark it stale immediately so the next swipe recreates instead of trusting it.

### 6. Watchdog self-heals (speech.ts)
When the startup watchdog fires, also mark the context stale — the very next swipe gets a fresh engine instead of re-failing on the same one.

Everything else (token refresh-on-401, bounded 429/5xx retry, replay cache, Sound-off billing gate) stays as is.

## Files

- `src/lib/speech.ts` — liveness check, stale-on-foreground, bounded resume, statechange listener, watchdog self-heal
- `src/lib/audio-session.ts` — `assertMixableSessionWithRetries()` helper
- `tests/speech.test.ts` — cover: frozen-`currentTime` context gets replaced; foreground return marks context stale and the next speak builds a new one; hung/slow resume escalates to recreate; watchdog marks the context stale

## Verification

- Run `tests/speech.test.ts` and check the build log.
- iPhone sanity: swipe to hear speech → switch to Voice Memos and record (or play music) → return to Orby → swipe again. Speech must start on the first swipe, every time, without restarting the app.

## Out of scope

No UI changes, no voice changes, no recording/microphone changes (that path was fixed separately), no changes to the TTS route or gateway.
