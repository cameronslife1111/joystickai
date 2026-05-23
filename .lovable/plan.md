## Goal
Expand Orby's call mode so the user can, by voice:
1. **Read documents** into the call's context (silent ingest + show on screen).
2. **Add text** to a named document.
3. **Mark sentences for deletion** (soft flag — no hard delete).
4. Give the user 2s more breathing room before Orby responds.

---

## 1. Pause window
`src/contexts/CallModeContext.tsx` — change `schedulePauseCommit` timeout from `1200` → `3200` ms.

---

## 2. New "pending_delete" flag (DB migration)
Add a nullable boolean column to `sentences`:
- `pending_delete boolean not null default false`
- Index on `(document_id, pending_delete)` for cheap filtering.

Rendering: in the orb sentence view and edit view (`src/routes/_authenticated/app.tsx`) + `src/components/SentenceText.tsx`, sentences with `pending_delete = true` render with a strikethrough and muted red tint. The user clears or confirms them later from the existing edit/delete UI (out of scope for this turn — flag only).

---

## 3. New voice intents
Extend `src/lib/call-phrases.ts` with three matchers and a tiny "extract target document name" helper:

- `isReadDocPhrase` — "read that document", "read the … document", "open …", "pull up …", "load …", "find the document called …", "read those documents", etc.
- `isAddTextPhrase` — "add to … document", "append to …", "write … in the … doc", "put this in …".
- `isMarkDeletePhrase` — "mark … for deletion", "flag … for deletion", "mark that sentence for deletion", "cross out …".

Multi-doc support: if the matched phrase contains "and" / "both" / "those documents", capture multiple titles.

---

## 4. Call orchestration changes
`src/contexts/CallModeContext.tsx` — extend `commitUtterance` after the existing plan/hangup branches:

### a. Read-document branch
1. On match, call a new `resolveDocumentByVoice` server fn (see §5) with the utterance + recent transcript so the LLM picks the best document title via fuzzy match across the user's docs.
2. While resolving, set status to `speaking` and surface a new UI state `reading: { docTitles: string[] }` on the context.
3. CallOverlay shows: orb caption "Reading **{title}**…", and below it a scrollable panel with the document's sentences (read-only).
4. After ingest, append a synthetic assistant message to `messages` for AI context:
   `[document: "{title}"]\n1. sentence one\n2. sentence two\n…`
   so subsequent turns can answer questions about it.
5. Orby says one short line ("Got it, ready for your question.") and returns to `listening`. No sentence-by-sentence TTS.

Multiple docs: resolve & ingest in parallel, panel shows tabs per document.

### b. Add-text branch
1. Resolve target doc (same fuzzy resolver, prompt variant: "find the doc the user wants to add to").
2. If ambiguous (no confident match), Orby asks aloud "Which document — A or B?" and the branch aborts (user re-speaks).
3. On confident match, call existing `insert_sentences_at` RPC (RLS-scoped to the user) at the end of the doc with the LLM-cleaned text to add.
4. Orby confirms briefly: "Added to {title}." No plan, no confirmation dialog.

### c. Mark-for-deletion branch
1. Resolve target doc + the sentence(s) to mark via a new server fn `markSentencesForDeletion` that takes the utterance, asks the LLM which sentence indexes in which doc to flag, and updates `sentences.pending_delete = true` for those rows.
2. Orby confirms: "Marked {N} sentence(s) in {title} for deletion."

All three branches use the same pattern as the existing `isMakePlanPhrase` branch (stop recognition → speak → resume listening).

---

## 5. New server functions (TanStack `createServerFn`)
File: `src/lib/orby-call-docs.functions.ts`. All `.middleware([requireSupabaseAuth])` so RLS scopes everything to the caller.

- **`resolveDocumentsByVoice({ utterance, recentTranscript, expectMultiple })`** — loads the user's documents (id + title), asks Lovable AI (`google/gemini-3.5-flash`) to return the best matching `document_id`(s) + confidence. Returns `{ matches: [{id, title, confidence}] }`.
- **`readDocumentsForCall({ documentIds })`** — returns each doc with its ordered sentences (id, order_index, content) for display + LLM context.
- **`addTextToDocument({ documentId, text })`** — splits text into sentences (`splitIntoSentences`) and calls the existing `insert_sentences_at` RPC at the end.
- **`markSentencesForDeletion({ utterance, documentId })`** — fetches sentences, asks the LLM which `order_index` values match, updates `pending_delete = true` for those rows.

---

## 6. UI: CallOverlay updates
`src/components/CallOverlay.tsx`:
- New state slice from context: `readingDocs: Array<{id, title, sentences: string[]}> | null`.
- When present, replace the caption strip with a stacked panel:
  - Heading: "📄 {title}" (tabs if multiple).
  - Scrollable list of sentences (max ~50vh), uses existing typography (Poppins, current sizes).
  - Dismiss "✕" returns to normal caption view (but the docs stay in the AI's context for follow-up questions).

Status label additions:
- `reading` → "Reading {title}…"
- `adding` → "Adding to {title}…"
- `marking` → "Marking sentences…"

---

## 7. Chat system prompt (`src/lib/orby-call.functions.ts`)
Append two paragraphs so the assistant knows:
- It now has access to attached document contexts (delivered as assistant messages of the form `[document: "..."]`); answer follow-up questions using them.
- When the user asks to read / add to / mark sentences in a document, just acknowledge briefly — the client handles execution.

---

## Technical notes
- The `pending_delete` flag is purely soft; existing delete RPC and UI keep working. Hard deletes never happen from the call.
- Fuzzy matching uses Lovable AI (no extra deps) — cheap & robust to mispronunciations.
- Pause window: 3.2s is a meaningful change; if it ends up too sluggish we can tune downwards in one line.
- All new RPC paths respect existing RLS (`own sentences …`, `own documents …` policies).
