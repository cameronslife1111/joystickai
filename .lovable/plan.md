# Red orb checkbox toggle + Baby steps (slot 24)

## 1. Red orb: long press deletes, tap toggles a checkbox

- Long press the red orb → delete the current sentence (exactly today's delete behavior, including the undo toast).
- Single press the red orb → toggle `☑️ ` at the very front of the current sentence:
  - not there → add it and the sentence reads `☑️ <text>`
  - already there → remove it (and the following space)
- Instant feel: the on-screen sentence updates immediately (optimistic cache write), the database update happens right after. No speech is triggered, no navigation, no toast spam — an emoji toast only if the save fails.
- Tolerates the emoji with or without the variation selector and with or without a trailing space, so repeat taps always toggle cleanly.
- Orb label becomes "Add/remove checkbox (hold to delete)".

## 2. Slot 24 becomes "Baby steps" (👣) instead of "Swap slot"

Pressing it in the menu:

1. Closes the menu and shows a loading indicator (emoji toast, so the user sees it's working).
2. Sends the current document title, the current sentence, and the surrounding lines to OpenAI, which decides whether the line is a substep or a main step and breaks it into exactly **4 baby steps** in Go-To format.
3. Replaces the current sentence with: any notes first, then the 4 baby steps.
4. The text is split into sentences the same way pressing Done in the editor does, so each line becomes its own row.
5. The view lands on the first generated sentence and reads it aloud.
6. Undo: an emoji toast with ↩️ restores the original single sentence in its original position.

### Go-To format rules given to the model

- Every step: `Go to the X and Y.` — X is where to go (app, button, folder, physical place or item), Y is what to do there, at most 7 words, very concise.
- Examples: `Go to the keys and put them in your pocket.` / `Go to your shoes and tie them.`
- Anything that isn't an action becomes a note: `Note: <one short sentence>.` Notes are used sparingly, only for information the original line stated that isn't a step, and they are placed before the 4 steps.
- Every line ends with a period. Plain text only — no markdown, numbering, or bullets.

The swap-slot behavior is removed from the menu (the underlying helper is no longer wired to a button).

## Technical notes

- `src/components/OrbCluster.tsx`: red orb gets `onPress` = checkbox toggle, `onLongPress` = delete; new props `onToggleCheckbox` / `onDeleteLongPress` replacing `onDelete`.
- `src/routes/_authenticated/app.tsx`: new `toggleCheckbox` callback (optimistic `qc.setQueryData(["sentences", activeDocId])` + `supabase.from("sentences").update`), wired to the red orb tap; `deleteCurrent` moves to the long press. Slot 24 entry replaced with `{ e: "👣", t: "Baby steps", fn: handleBabySteps }`; `handleBabySteps` calls the new server function, then `commit_document_edit`-equivalent replacement via `insert_sentences_at` after deleting the original row (single RPC path already used by AI inserts), then `setIndex` to the first new line and `speak`.
- New `src/lib/baby-steps.functions.ts`: `createServerFn` + `requireSupabaseAuth`, mirrors `src/lib/delegate.functions.ts` — loads the document and its sentences, builds the window with `buildDocWindow`, calls `gpt-5.6-sol` through `createOpenAiProvider(process.env.OPENAI_API_KEY)`, returns `{ notes: string[], steps: string[] }` validated with zod (steps trimmed to 4, periods enforced server-side).
- Prompts live in a new `src/lib/baby-steps-prompt.ts` alongside the existing delegate prompts.
- Splitting reuses `splitIntoSentences` from `src/lib/sentences.ts`.

## Out of scope

No changes to the other orbs, the editor UI, chat, or plan generation.
