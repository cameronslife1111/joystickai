# Replace device speech with low-latency Google TTS

## Decision

Use **Google Gemini 2.5 Flash TTS through Lovable AI** (`google/gemini-2.5-flash-tts`). This requires no Google API key and is the lowest-cost Google speech model currently offered through Lovable.

This is not Google Cloud's legacy Standard TTS product or its advertised ~$4 per million characters. Lovable exposes Gemini TTS, billed through Lovable AI credits using Gemini's token-based pricing. If that exact Standard pricing becomes essential later, it would require a separate Google Cloud account and credentials.

Google does not officially label Gemini's prebuilt voices by gender. The menu will present four US-English-sounding choices chosen by listening profile—two lower/masculine-leaning and two higher/feminine-leaning—without claiming that Google assigns them a gender:

- Charon — clear, informative
- Fenrir — energetic, lower voice
- Kore — firm, higher voice
- Aoede — breezy, higher voice

## User experience

1. **Turn Slot 4 into Sound settings**
   - Pressing Slot 4 opens a compact sound menu instead of immediately toggling sound.
   - The menu contains an on/off switch and the four voice choices.
   - Selecting a voice saves it and plays a short sample through the real production TTS path.
   - Turning sound off immediately stops any request and queued/playing audio.
   - Preserve the current sound icon/label so the slot remains recognizable.

2. **Use one hosted-speech controller everywhere**
   - Replace the native `speechSynthesis` implementation with one shared client controller for sentence reading, Repeat, auto-repeat, document changes, chat read-aloud, plan cues, and mouth animation state.
   - Preserve the current “newest action wins” behavior: a new sentence aborts the previous request, stops scheduled audio, and starts the new sentence.
   - Keep emoji cleanup, mute/recording guards, stale-token protection, end/error callbacks, and the existing chat stop controls.
   - Remove all remaining checks and direct dependencies on `window.speechSynthesis` from these flows.

3. **Stream Google speech through a protected app endpoint**
   - Add an authenticated TanStack API route that validates the signed-in user before calling Lovable AI.
   - Read `LOVABLE_API_KEY` only on the server and call `/v1/audio/speech` with Gemini's required body shape, `stream_format: "sse"`, audio output modality, and the selected prebuilt voice.
   - Forward the SSE response without buffering so playback can start as audio chunks arrive.
   - Forward only safe `X-Lovable-AIG-*` correlation headers; never expose the API key.
   - Forward explicit user cancellation to the gateway and return 499 rather than turning cancellation into an error.

4. **Optimize for perceived latency and cost**
   - Create/resume one 24 kHz Web Audio context synchronously from the user's button press, before the network request, to satisfy mobile playback rules.
   - Decode each streamed PCM chunk and schedule it immediately rather than waiting for the complete sentence.
   - Keep a small in-memory LRU cache keyed by cleaned text + voice so Repeat and the two-minute auto-repeat replay instantly without a second paid generation.
   - Do not pre-generate neighboring sentences, because that would spend credits on speech the user may never play.
   - Reuse connections where the runtime permits and avoid artificial request timeouts.

5. **Persist the selected voice safely**
   - Add a nullable `tts_voice` preference with a default voice in `user_preferences`.
   - Include the required table grants and retain the existing row-level access model.
   - Update preference reads/writes so changing another setting cannot overwrite the selected voice or mute state with stale values.

6. **Make failures visible but unobtrusive**
   - Show the gateway's returned message in a toast when speech fails; do not silently fall back to unreliable device speech.
   - Treat 400/401/402/403 as terminal. For 402/403, explain that credits or workspace access require owner action.
   - Retry only 429/5xx, at most once and only after the required backoff; a newer sentence cancels that retry.
   - Keep the displayed sentence and navigation responsive even when speech fails.

## Technical files

- Replace `src/lib/speech.ts` with the streaming playback/controller implementation.
- Add a server-only Lovable TTS helper and `src/routes/api/public/tts.ts`.
- Add a focused Sound settings dialog component.
- Update `src/routes/_authenticated/app.tsx`, `src/components/ChatDialog.tsx`, and `src/hooks/use-orb-mood.ts` to use the shared controller.
- Add a database migration for `user_preferences.tts_voice`; refresh generated database types through the supported backend workflow rather than hand-editing generated files.
- Rewrite `tests/speech.test.ts` and add route/controller coverage.

## Verification before release

- Provision the project-scoped Lovable AI key if absent, then make one real request through the exact app route and confirm streamed audio and the gateway run ID.
- Test each of the four voices through the menu.
- Test rapid Previous/Next presses: previous audio stops and the newest sentence begins without overlap.
- Test Repeat cache, two-minute auto-repeat, document switching, Sound off, chat Play/Stop, auto-read replies, and recording guards.
- Verify terminal and retryable gateway error messages are surfaced correctly.
- Run focused tests, inspect build/runtime logs, and use the live app to verify controls and streaming.
- Final physical-device check on iPhone speaker and AirPods, including rapid navigation. Audio ducking/routing is ultimately controlled by iOS, but this path removes the unreliable device speech synthesizer and plays normal streamed audio instead.

## Out of scope

No return to browser/device speech, no direct Google Cloud credentials, no voice cloning, no changes to sentence navigation or Orb layout, and no speculative pre-generation that spends credits before the user requests speech.
