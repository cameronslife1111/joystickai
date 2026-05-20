# Call Mode with Orby

Add a yellow "Call Orby" button to the Plan Composer dialog. Tapping it starts a live, hands-free voice conversation with Orby. The conversation feels like a phone call: Orby greets the user, the mic auto-detects pauses and sends each utterance, Orby replies aloud, and the back-and-forth continues until the user asks to end the call — or asks Orby to "generate a plan", at which point the entire transcript becomes a proposed plan the user can approve.

## UX flow

1. In `PlanComposerDialog`, add a yellow secondary button "📞 Call Orby" next to "Generate Plan".
2. Tapping it closes the composer and enters Call Mode:
   - Orb turns white/yellow (new CSS variant `orb-call`).
   - A minimal full-screen Call overlay appears: Orby in the center, a live caption strip ("Listening…" / "Orby is speaking…" / partial transcript), a mute mic toggle, and a red "End call" button.
   - Orby greets: "Hey, I'm listening. What's on your mind?"
3. The user can dismiss the overlay (swipe down or tap a small minimize chevron) and keep using the entire app normally. Call mode keeps running in the background — sentence auto-read (`speak()` for the active sentence) is suppressed while the call is live; only the Orby conversation is audible. The Orb itself stays white/yellow everywhere as the visible "call active" indicator, and tapping it re-opens the call overlay.
4. The call ends when:
   - The user taps "End call".
   - The user says an end phrase ("hang up", "end the call", "goodbye", "bye", "talk to you later"…).
   - The user says a generate-plan phrase ("generate a plan", "turn that into a plan", "make that a plan"…). Orby says "Okay, generating that plan now." then hangs up, and the full transcript is sent to `plan-compose` as the user_request. The existing composing-plans watcher fires the "Plan ready" toast as usual.

## Voice loop (iOS Safari / Chrome mobile + desktop)

Browser Web Speech API behavior differs sharply between iOS Chrome (which uses WKWebView and historically lacks `SpeechRecognition`), iOS Safari (added partial support recently but unreliable in background), and desktop Chrome (full support). To get a phone-call feel that works on iPhone 16 in Chrome mobile, use a hybrid:

- **Primary path (desktop Chrome + iOS Safari where available):** `webkitSpeechRecognition` with `continuous=true`, `interimResults=true`. Detect pauses by watching for ~1.2s of no new interim results after a final result, then commit the utterance and send.
- **Fallback path (iOS Chrome and any browser without SpeechRecognition):** `MediaRecorder` + manual VAD using a `WebAudio` `AnalyserNode`. Compute RMS every 50ms; start an utterance when RMS crosses a threshold (with a 150ms "speech started" debounce) and end it after ~1000ms below threshold ("silence hangover"). Slice the recorded blob and send to a new server function `transcribe-audio` that calls a transcription API.

A small `useCallSession` hook abstracts both paths behind one interface:
```
start(), stop(), onUtterance(text), onPartial(text), pauseMic(), resumeMic()
```

**Barge-in:** while Orby is speaking (`speechSynthesis.speaking`), the mic is paused. The moment a final utterance lands, `speechSynthesis.cancel()` is called so the user can interrupt mid-reply.

**Turn-taking:**
- User finishes utterance → pause mic → send transcript + rolling history to `chat-with-orby` server function (streamed) → speak the response with `speechSynthesis.speak()` → resume mic on `onend`.
- Adaptive silence threshold: start at 1000ms, extend to 1800ms if the last utterance ended with a filler word ("um", "uh", "like", "so") to avoid cutting the user off mid-thought.

## Server side

New server function `chatWithOrby` in `src/lib/orby-call.functions.ts` (auth-protected):
- Input: `{ messages: ChatMsg[], userRequestSoFar: string }`.
- Calls GPT-5.5 via the Lovable AI Gateway with a system prompt: "You're Orby on a live voice call. Keep replies short (1–2 sentences), conversational, and easy to listen to. Never use markdown or emoji. If the user asks you to make/generate/turn this into a plan, reply with exactly the JSON token `{{MAKE_PLAN}}` then a one-sentence confirmation."
- Returns assistant text. Client detects the `{{MAKE_PLAN}}` sentinel and triggers plan generation locally (no server-side coupling needed).

New server function `transcribeAudio`:
- Input: base64 audio chunk + mime type.
- Calls OpenAI `gpt-4o-mini-transcribe` (already have `OPENAI_API_KEY`) and returns `{ text }`.
- Used only by the fallback path.

Plan generation reuses the existing `plan-compose` flow — the full call transcript is concatenated as `user_request` and submitted via the current pipeline. No new plan tables or status states.

## State / hooks

- New `useCallSession` hook owns: mic stream, recognizer/recorder, VAD, turn-taking, history array, status (`idle | listening | thinking | speaking | ending`).
- New `CallModeContext` provider mounted in `_authenticated/app.tsx` so the session survives navigation between Editor and Media. Exposes `startCall()`, `endCall(reason)`, `inCall`, `status`, `transcript`.
- `app.tsx`: when `inCall` is true, suppress the active-sentence `speak()` and the 2-minute auto-repeat timer. Pass `inCall` to the Orb to apply the `orb-call` class.

## Visuals

- Add `.orb-call` class in `src/styles.css` overriding aurora filters to a white/warm-yellow palette and a slow "ring pulse" animation (call-waiting feel).
- `CallOverlay.tsx`: full-screen `fixed inset-0 z-[60]` with backdrop blur, centered Orb (size 220), live caption (`role="status"` for a11y), and bottom bar with Mute / End call. Mobile-first layout (`h-[100svh]`, safe-area padding).
- `PlanComposerDialog.tsx`: footer becomes a 2-button row — yellow "📞 Call Orby" (calls `startCall()`, closes dialog) and the existing "Generate Plan".

## iPhone 16 / Chrome mobile specifics

- Request `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` on the user tap (must be inside a user gesture on iOS).
- Keep an `AudioContext` alive for the session; resume it on visibilitychange.
- Use `speechSynthesis.speak()` inside a user gesture for the first utterance (Orby's greeting plays on the tap that started the call) to unlock TTS on iOS.
- Add a `wakeLock` request (where supported) so the screen doesn't sleep mid-call.
- Use `AudioContext.sampleRate` to record at 16kHz mono opus for fast upload on cellular.

## Files

New:
- `src/components/CallOverlay.tsx`
- `src/contexts/CallModeContext.tsx`
- `src/hooks/use-call-session.ts`
- `src/hooks/use-vad.ts`
- `src/lib/orby-call.functions.ts` (chatWithOrby, transcribeAudio)
- `src/lib/call-phrases.ts` (end-call + make-plan phrase matchers)

Modified:
- `src/components/PlanComposerDialog.tsx` — add yellow Call button.
- `src/routes/_authenticated/app.tsx` — mount provider, suppress speak/auto-repeat when `inCall`, apply orb-call class.
- `src/components/Orb.tsx` — accept `inCall` prop, add white/yellow visual state.
- `src/styles.css` — `.orb-call` tokens + pulse animation.

## Out of scope

- No persisted call history (transcript lives in memory; only saved into the plan when the user asks for one).
- No multi-participant calls, no streaming TTS (browser `speechSynthesis` is good enough and free).
- No background-tab audio capture beyond what mobile browsers already allow — if the OS pauses the tab, the call gracefully ends with a toast.
