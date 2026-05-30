## Goal

Transform the Orby live call into a hands-free controller for the app. It opens already minimized (main app visible, orb yellow), listens via OpenAI Whisper for fast natural turns, and can act on the user's documents and sentences by voice — never generating plans anymore.

## 1. Remove plan generation from call mode

- Strip plan logic from `CallModeContext`: remove `generatePlanFromConversation`, `generatePlanFromConversationInternal`, `generatePlanRef`, the `distillCallTranscript` import/use, the `isMakePlanPhrase` branch, and the `"plan"` end-call reason.
- `CallOverlay`: remove the "Make plan" yellow button and its handler.
- `call-phrases.ts`: remove `PLAN_PATTERNS` / `isMakePlanPhrase`.
- Update `chatWithOrby`'s system prompt (in `orby-call.functions.ts`) to drop all "make a plan" instructions; keep `distillCallTranscript` server fn in the file (it's still used elsewhere for the separate plan composer) but no longer call it from the call.
- Net effect: the call no longer knows about plans. The standalone plan composer (`PlanComposerDialog`, etc.) is untouched.

## 2. Start the call already minimized

- `startCall`: set `overlayMinimized` to `true` right away so the user sees the main app (orb + their current sentence) with the existing yellow "On a call with Orby" pill at top. The orb already turns yellow via the `orb-call` class while `inCall`.
- Keep the greeting spoken inside the start gesture (needed to unlock iOS audio), but speak a shorter line (e.g. "I'm here.").
- The expanded overlay still works when the user taps the pill; the in-overlay reading panel stays available.

## 3. Switch speech-to-text to OpenAI Whisper (faster, natural turns)

Replace `webkitSpeechRecognition` with mic capture + Whisper transcription:

- Client: capture mic with `MediaRecorder`, and use a Web Audio `AnalyserNode` for silence/VAD detection. Buffer audio while the user speaks; when silence is detected (~600–800ms, tunable — far shorter than today's 3200ms pause), stop the current segment, package the audio (webm/opus), and send it to a new server function for transcription. Then immediately re-arm for the next segment.
- New server fn `transcribeAudio` in `src/lib/orby-stt.functions.ts` (`createServerFn`, `requireSupabaseAuth`): accepts the audio blob (base64), forwards to OpenAI `POST /v1/audio/transcriptions` with `model: gpt-4o-transcribe` (Whisper-family) using `OPENAI_API_KEY`, returns `{ text }`. Reject empty/very-short clips.
- While Orby is speaking (TTS) or processing, pause capture so it doesn't transcribe its own voice; resume after.
- Output stays the browser `speechSynthesis` TTS (`speakAsync`) exactly as today.
- Show interim "Listening…/Thinking…" via existing `status`/`actionLabel`.

## 4. LLM intent router (replaces brittle regex matching)

Add `interpretCommand` server fn in `src/lib/orby-call-intent.functions.ts`. After each transcript, send it (plus the active-document context and recent turns) to the model and get back a structured action:

```text
{ action: "jump" | "open_doc" | "find_doc" | "read_doc"
        | "edit_sentence" | "add_text" | "mark_delete"
        | "rename_title" | "chat" | "end_call",
  ...action-specific fields (target text, doc hint, sentence hint, new text) }
```

The router resolves document references with the existing `resolveDocumentsByVoice` fuzzy matcher and resolves sentence references against the active doc's sentences (by ordinal "sentence 4", or by meaning "the one about X"). `chat` falls through to `chatWithOrby` for normal conversation. This is far more robust than `call-phrases.ts` regex; that file's remaining matchers can be retired.

## 5. Bridge the call to the live app (jump / open)

The call runs in `CallModeContext`; the active document + sentence index live in `app.tsx`. Add a lightweight controller bridge:

- `CallModeContext` exposes `registerCallController(controller)` and an internal ref.
- `app.tsx` registers a controller in an effect exposing: `getActiveContext()` (active doc id, title, current index, sentence list), `openDocumentById(id)`, and `jumpToIndex(i)` (reusing its existing `setActiveDocId` + `setIndex` logic so it persists `current_sentence_index` and refreshes the view/speech).
- Voice "jump to / move to sentence …" → resolve index → `jumpToIndex`. "Open the document titled …" → resolve doc → `openDocumentById`. The main app view updates live while minimized, and Orby confirms aloud.

## 6. Document/sentence actions (all confirm the target aloud)

Server functions in `orby-call-docs.functions.ts` (extend existing):

- `addTextToDocument` (exists) — keep; always reply "Added to ‹title›." Reuse `insert_sentences_at`.
- `markSentencesForDeletion` (exists) — keep; sets `pending_delete`.
- `editSentence` (new) — "change this sentence to say …": resolve target sentence (active doc / context) via LLM, update `content`, reply with the title + which sentence.
- `renameDocumentTitle` (new) — "rename this document to …" / "change the title to …": resolve doc, update `documents.title`, reply with old→new title.
- `readDocumentsForCall` (exists) — "read … and tell me …": load as assistant context so the follow-up answer uses it; keeps the overlay reading panel.
- `resolveDocumentsByVoice` (exists) — powers "what's the name of the document about …": Orby answers "The title you may be referring to is ‹title›."

After every mutating action, Orby **speaks the document it touched** ("Added that to ‹Morning Routine›.") so the user can correct a wrong title, and the relevant React Query caches (`["documents"]`, `["sentences", docId]`) are invalidated so counts/positions update without leaving the page.

## 7. Tighten timing & polish

- Replace the 3200ms pause commit with VAD-driven segmentation (~700ms silence) for natural back-and-forth.
- Guard against transcribing Orby's own TTS (capture paused during `speaking`).
- Keep wake-lock, mic-mute, visibility re-arm, and cleanup behavior.

## Technical notes

- New files: `src/lib/orby-stt.functions.ts`, `src/lib/orby-call-intent.functions.ts`. Extend: `src/lib/orby-call-docs.functions.ts`, `src/contexts/CallModeContext.tsx`, `src/components/CallOverlay.tsx`, `src/routes/_authenticated/app.tsx`, `src/lib/orby-call.functions.ts`.
- All new server fns use `createServerFn` + `requireSupabaseAuth` (RLS scopes to the user). `OPENAI_API_KEY` is already present and read inside handlers.
- `attachSupabaseAuth` is already wired in `src/start.ts` (existing protected fns work), so no auth-middleware changes needed.
- No database schema changes required.
- Browser support: Whisper path needs `MediaRecorder` + `getUserMedia` (already requested today) + Web Audio; keep a clear unsupported-browser toast.

## Out of scope

- The separate plan composer / scheduled plans feature stays exactly as-is; we only remove plan generation *from the live call*.
