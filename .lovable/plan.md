# Guarantee: Sound off = zero text-to-speech charges

## What I verified in the code

Speech is billed only when the app calls the `/api/public/tts` route, and every call in the app funnels through one function: `speakText()` in `src/lib/speech.ts`. So the fix can be enforced at a single choke point.

Current state of each trigger:

**Already safe (no charge when Sound is off):**
- Sentence reading on orb presses, Repeat, the 2-minute auto-repeat, and document switching — all go through `speak()` in `src/routes/_authenticated/app.tsx`, which returns immediately when the persisted `muted` preference is on. The auto-repeat timer checks it again at fire time.
- Turning Sound off also calls `cancelSpeech()`, which aborts any in-flight request and stops queued audio.
- The voice preview button in the Sound menu is disabled while Sound is off.
- The "prefetch" warm-up on swipe targets only preloads sentence *text* from the database — it never generates audio.

**Not safe today (can still charge with Sound off):**
- The chat window (`src/components/ChatDialog.tsx`) never reads the global Sound setting. Its speech is gated only by the chat-local "Read replies aloud" checkbox, so with Sound off these can still fire paid requests:
  - Auto-reading an assistant reply when it arrives or when a thread is opened
  - The "Planning now." cue and the plan announcement cue in `PlanProgressCard`
  - The per-message Play button (explicit press, but currently ignores the Sound setting)

## The fix

1. **Add a master switch inside the speech engine** (`src/lib/speech.ts`)
   - Add a module-level `speechEnabled` flag (default off until preferences load) with an exported `setSpeechEnabled(on: boolean)`.
   - `speakText()` returns `false` immediately when disabled — before touching the token cache, the network, or the audio engine. Since every speech path in the app (sentences, chat, plan cues, previews) calls `speakText`, this one gate makes "Sound off → zero TTS requests → zero charges" structurally guaranteed, not just convention.

2. **Wire the switch to the Sound preference** (`src/routes/_authenticated/app.tsx`)
   - In the existing effect that syncs `mutedRef` from the persisted preference, also call `setSpeechEnabled(!muted)`.
   - `saveMuted(true)` already cancels in-flight speech; keep that.

3. **Chat UX polish** (`src/components/ChatDialog.tsx`)
   - When Sound is off and the user presses a message's Play button, show a short toast ("Turn on Sound to hear messages") instead of silently doing nothing.
   - Auto-read and plan cues need no code changes — the engine gate blocks them automatically.

## Files

- `src/lib/speech.ts` — enabled flag + hard gate at the top of `speakText`
- `src/routes/_authenticated/app.tsx` — sync the flag from the `muted` preference
- `src/components/ChatDialog.tsx` — Play-button hint when Sound is off
- `tests/speech.test.ts` — cover: disabled engine makes no fetch call; re-enabling restores speech

## Verification

- Unit test: with speech disabled, `speakText` returns false and zero network requests are made.
- Live check: turn Sound off, navigate sentences, open a chat with "Read replies aloud" on, send a message — confirm in the network log that no `/api/public/tts` request fires; turn Sound back on and confirm speech resumes.

## Out of scope

No changes to voices, latency, the Sound menu layout, or the billing/retry logic — this only adds the off-switch guarantee.
