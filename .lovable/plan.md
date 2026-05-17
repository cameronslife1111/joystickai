## Goal
Add a new menu button that lets you import a `.txt` file containing many checklists, and turn each checklist into its own document in Joystick AI — one document per title, one sentence per checkbox line.

## File format (what the parser expects)
```
===Title One===
[ ] First item
[x] Second item
[ ] Third item

===Title Two===
[ ] Another item
...
```

Rules:
- A title line starts and ends with exactly `===` (3 equal signs). Whatever is between becomes the document title.
- Every non-title line that follows belongs to that title, until the next `===…===` line.
- For each item line: strip a leading checkbox marker (`[ ]`, `[x]`, `[X]`, optionally preceded by `-` or `*` and whitespace). The remaining text is the sentence.
- If the resulting sentence doesn't end in `.`, `!`, or `?`, a `.` is appended.
- Blank lines and lines without a checkbox marker under a title are ignored (safest default — let me know if you want them kept as plain sentences instead).
- Titles with zero checkbox lines are skipped (no empty documents).

## New menu button
- Emoji `📥`, label "Import checklists".
- Place it in slot **9** (currently empty) so the existing layout stays intact.
- Tap behavior: close the menu, open a hidden `<input type="file" accept=".txt,text/plain">`, then process the chosen file.

## Import flow
1. Read file as text (`file.text()`).
2. Parse into `{ title, sentences: string[] }[]` using the rules above.
3. If nothing parsed → `toast.error("No checklists found")` and stop.
4. Show a confirm dialog: `Import N checklists as N new documents?`
5. For each parsed checklist, in order:
   - Insert a new row into `documents` (title = parsed title, `position` = current end + index).
   - Call the existing `insert_sentences_at` RPC with `p_document_id`, `p_contents = sentences`, `p_insert_at = 0`.
6. Show progress toast (`Imported X / N`) and a final `Imported N checklists` toast.
7. `qc.invalidateQueries({ queryKey: ["documents"] })` and switch to the first newly created doc.

## Files touched
- `src/routes/_authenticated/app.tsx` only:
  - Add the new action to the `grid` array.
  - Place it at `filled[8]` (slot 9) in the `slots` memo.
  - Add a hidden file input ref + `handleImportFile` async handler.
  - Add a small `parseChecklists(text)` helper near the other text utilities.

No DB migrations, no schema changes — reuses existing `documents` table and `insert_sentences_at` RPC.

## Out of scope
- No background/queued import; 300–400 small docs is fine to do sequentially client-side, but if it feels slow we can later batch. Tell me if you want a progress bar instead of a toast.
- No de-dup against existing documents with the same title.
