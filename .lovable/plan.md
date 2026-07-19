## Voice-to-Chat via long-press on Orby

Replace "long-press opens last chat" with "long-press = hold-to-record voice note that becomes a new chat message in the background." Slot 11 keeps its current behavior.

### Behavior

1. **Long-press start** (~500ms hold): begin recording via mic. Orb's aura swells and turns pure red to signal recording. No dialog opens.
2. **Long-press release**: stop recording. In the background:
   - Upload the audio to a server function, transcribe with OpenAI Whisper via Lovable AI Gateway (`openai/gpt-4o-transcribe`).
   - Create a new `chat_threads` row.
   - Insert the transcript as the first `chat_messages` user row on that thread.
   - Run the exact same send pipeline `ChatDialog.handleSend` uses (intent classification via `sendChatMessage`; if `route === "plan"` → insert `plans` row + fire `plan-compose`; if text → insert assistant reply).
   - Auto-name the thread from the transcript (existing `nameThread` server fn).
3. **Toaster feedback** (from the app shell, not inside ChatDialog):
   - While transcribing: subtle spinner toast "Listening…" (id-scoped so it can be replaced).
   - On plan started: blue toast "🧠 Plan started — open" — clicking opens ChatDialog on that thread.
   - On text reply ready: blue toast "💬 New message — open" — clicking opens ChatDialog on that thread.
   - On error: red toast with the reason.
4. **No UI blocking.** Cameron can swipe, edit, kick off another voice note, etc. Each voice note spawns an independent background job keyed by its own thread id.
5. **Cancel guardrails**: if recording is under ~400ms of audio, discard silently (accidental tap). If mic permission denied, red toast once.

### Recording specifics (matches `ai-speech-to-text` guidance)

- Use the Web Audio API + `ScriptProcessor`/`AudioWorklet` to capture PCM, encode a complete 16 kHz mono WAV `Blob` at stop. Do NOT use `MediaRecorder` timeslice — WAV avoids Safari's fragmented MP4 issue.
- POST the WAV as `multipart/form-data` to a new server route `src/routes/api/public/transcribe.ts` (authenticated via bearer attach) — actually a `createServerFn` is cleaner here since it's app-internal. Use `createServerFn` with `.middleware([requireSupabaseAuth])`, receive the audio as a base64 string (small clips) or a `File` via FormData.
- Server function forwards to `https://ai.gateway.lovable.dev/v1/audio/transcriptions` with `LOVABLE_API_KEY`, `model: "openai/gpt-4o-transcribe"`, non-streaming (single buffered transcript is fine for this flow).

### Files touched

**1. `src/routes/_authenticated/app.tsx`**
- Remove `onLongPressStart`/`onLongPressEnd` that open the chat (~lines 1192-1199). Replace with a new `startVoiceRecording` / `stopVoiceRecording` pair.
- Add state: `recording: boolean` (drives red aura) and refs for `AudioContext`, mic stream, PCM buffers.
- Wire the new handlers into `useOrbGestures` in place of the old ones.
- Add `.orb-recording` class toggle on the `.orb-stage` when `recording` is true.
- Add a new async `dispatchVoiceMessage(transcript: string)` helper that reproduces the essential parts of `ChatDialog.handleSend`:
  - `supabase.from("chat_threads").insert({ user_id, title: "New chat" })`
  - Insert `chat_messages` (role=user) with the transcript.
  - Call the existing `sendChatMessage` server fn (imported from `@/lib/chat.functions`) with the single-message history and current `capabilities` (read from localStorage the same way ChatDialog does, or use full defaults).
  - Branch on `route === "plan"` vs text — same insert logic as ChatDialog.
  - On success, show blue action toast that calls `setChatOpen(true)` + selects that thread. Persist the target thread id via a new `pendingChatThreadIdRef` or a small state, and pass it to `ChatDialog` as an `initialThreadId` prop.
- `nameThread` call after first message (mirror ChatDialog lines 573-580).

**2. `src/components/ChatDialog.tsx`**
- Accept new optional prop `openOnThreadId?: string | null`. When it changes and dialog is open, call `setActiveThreadId(openOnThreadId)` and clear the parent's state.

**3. `src/lib/whisper.functions.ts`** (new)
- `transcribeAudio` server function with `.middleware([requireSupabaseAuth])`. Accepts `{ audioBase64: string, mimeType: string }`. Decodes to a Blob, builds FormData with `file` + `model: "openai/gpt-4o-transcribe"`, POSTs to `https://ai.gateway.lovable.dev/v1/audio/transcriptions` with `Authorization: Bearer ${process.env.LOVABLE_API_KEY}`. Returns `{ text: string }`.

**4. `src/styles.css`**
- Add `.orb-stage.orb-recording .orb-aura { … }` overriding the hue animation with a pure red (`radial-gradient(closest-side, rgba(255,0,0,.9), rgba(255,0,0,.4), transparent)`), boosted opacity to ~0.9, bigger `inset` (`-45%`) and stronger blur so the aura visibly swells. Pause `orb-aura-hue`, keep `orb-aura-pulse` running with a slightly faster/larger scale for a heartbeat feel.

**5. `src/lib/audio-recorder.ts`** (new small util)
- `startPcmRecorder()` returns `{ stop(): Promise<Blob> }`. Uses `getUserMedia`, `AudioContext`, script processor, downsamples to 16 kHz, encodes WAV on stop, closes tracks and context.

### Why Lovable AI Gateway instead of Cameron's OpenAI key

The gateway already proxies OpenAI Whisper via `openai/gpt-4o-transcribe`, is billed on the workspace's LOVABLE_API_KEY (already provisioned), never exposes a key to the browser, and is the documented path in this stack. Same underlying Whisper model. If Cameron specifically wants to burn his personal OpenAI key instead, say so and I'll swap to `OPENAI_API_KEY` — otherwise this is the cleaner default.

### Edge cases

- Recording already in flight when a second long-press starts → ignore start (single mic session).
- Long-press while `editing` is true → do nothing (matches current swipe policy).
- Long-press with no user session yet → red toast "Sign in first" (shouldn't happen inside `_authenticated`).
- Very short recording (<400ms of samples) → discard silently, no toast, no thread.
- Transcription empty string → discard silently, remove listening toast.
- Server fn 402/429 → surface reason in red toast.
- If ChatDialog is currently open on another thread, the toast still lets Cameron jump to the new one; existing per-thread `busyThreadIds` isolation already prevents cross-thread bleed.

### Non-goals

- No streaming transcription — one buffered result at stop is enough and simpler.
- No push-to-talk keyboard shortcut.
- No changes to Slot 11 or any other slot.
- No change to plan-compose / plan-tick internals.