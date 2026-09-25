# Keep reading aloud working after you leave the app, and stop the jump-back

Two separate problems, both happen right when you come back to Focus Remote on your iPhone.

## Problem 1: sound goes dead after visiting another app

What the code does today when you come back:
- It clears the speech queue and marks the voice list as "needs warming", then waits for your next press.
- On that press it switches the phone's audio mode to the "short prompt" mode and speaks. If nothing starts within 1.2 seconds, it tries once more with a named voice, then gives up with "Speech couldn't start".

Why that fails on iOS 27 (most likely causes, in order):
1. After YouTube, a Voice Memo or another Chrome tab takes the audio, iOS leaves the page's audio mode marked as interrupted. Asking for the same mode again is ignored because the page thinks it already has it, so speech is accepted but silent.
2. iPhone's speech engine can come back "paused" after the page was in the background. We deliberately never un-pause it, so new sentences sit in a stuck queue.
3. The one retry happens inside the same stuck state, so it fails too. Restarting the app works because it creates a fresh audio mode and a fresh speech engine.

The fix, from gentle to guaranteed:
1. **Fresh audio mode on return.** When the app comes back to the front, reset the audio mode to the phone's default first, then to the shared mode, so iOS truly re-grants it instead of treating it as already set.
2. **Un-stick the speech engine on return.** Cancel, then un-pause only if iOS reports it paused, before your next sentence. No silent sentences, nothing played on its own.
3. **Smarter retry.** If a sentence still doesn't start, do the full reset (audio mode + engine) and try that same sentence once more.
4. **Automatic restart as a last resort.** If speech still can't start after returning, the app quietly refreshes itself (the same thing you do by hand), keeping your document, sentence and sound setting, then reads that sentence. This only happens when sound is on and speech really failed — never while you're recording, in a live call, or typing.
5. Recording, music ducking and the Voice Memo protection from the last fix all stay as they are.

## Problem 2: pressing purple quickly after coming back jumps you back

What's happening:
- When you come back, the sign-in system quietly refreshes your login. Every refresh currently tells the app to reload *all* its data (documents, sentences, preferences). That's the delay you feel.
- If you press purple twice while that reload is in flight, your new spot gets saved, then the reload finishes with the older spot it fetched a moment earlier. The app treats that older spot as "changed on another device" and moves you back.

The fix:
1. Only reload everything when you actually sign in, sign out, or change accounts — not on the routine background login refresh. Nothing on screen changes from a refresh, so there's nothing to reload.
2. Remember when you last moved. A reload that started before your last move can never overwrite your spot; only genuinely newer changes from another device can.

## Checks on your iPhone 16E
- Read a sentence, switch to another Chrome tab, come back, press purple: it speaks.
- Same after YouTube Music and after a Voice Memo.
- Come back and press purple twice fast: you land two sentences ahead and stay there.
- Music still ducks and keeps playing; recording still works.

## Technical notes
- `src/lib/audio-session.ts`: add `resetIosAudioSession()` (type `auto` then `ambient`), called from foreground recovery and on `statechange` back from `interrupted`.
- `src/lib/speech.ts`: `handleAppForeground` resets session + `cancel()` + `resume()` only when `engine.paused`; mark a `returnedFromBackground` flag; watchdog/`onerror` path does full reset + one retry of the same text; if that fails and the flag is set, emit `orby-speech-hard-reset` with the text.
- `src/routes/_authenticated/app.tsx`: on hard-reset event (sound on, not recording/busy/in call), save current index (existing flush), store "speak on load" in sessionStorage, `location.reload()`; on load, speak the current sentence once after the first press is not required only if iOS allows — otherwise speak on first press. Guard with a 30s sessionStorage cooldown so it can never loop.
- `src/routes/__root.tsx`: in `onAuthStateChange`, skip `router.invalidate()`/`invalidateQueries()` for `TOKEN_REFRESHED` and `INITIAL_SESSION`.
- `app.tsx` documents queryFn: record `movedAt` in `localIdxRef` entries and the query start time; ignore server index when the fetch started before the last local move.
- Tests: extend `tests/speech.test.ts` for foreground reset, paused-engine resume, reset-then-retry, hard-reset event; keep all existing audio tests passing.

## Out of scope
Voices, speed, button mappings, visuals, backend data.
