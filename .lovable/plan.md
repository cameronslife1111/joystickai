## Changes to `src/routes/_authenticated/app.tsx`

### 1. Rename slot 9 button
- In the `grid` array, change `t: "Import checklists"` → `t: "Import text"` (emoji 📥 unchanged, behavior unchanged).

### 2. Loosen the importer to accept plain sentences
- In `parseChecklists`, after the existing `itemRe` checkbox match, fall back to treating any non-empty, non-title line as a sentence (skip blanks). Still auto-append `.` if missing terminal punctuation. This keeps existing checkbox-format files importing exactly as before AND accepts the new plain-text export.

### 3. Add Export text action
- Add a new entry to the `grid` array:
  - `{ e: "📤", t: "Export text", fn: handleExportAll }`
- New `handleExportAll` callback:
  1. Fetch all of the user's documents ordered by `position`.
  2. For each document, fetch its sentences ordered by `order_index`.
  3. Build a single string:
     ```
     === Title 1 ===
     Sentence one.
     Sentence two.

     === Title 2 ===
     ...
     ```
  4. Trigger a browser download as `joystick-export-YYYY-MM-DD.txt` using a Blob + temporary `<a download>` link.
  5. Toast success / error.
  6. Close the menu.

### 4. Wire into slot 17
- In the `slots` useMemo, add `filled[16] = grid[<new export index>];` (the new entry is appended at the end of `grid`, so the index is `grid.length - 1` at definition time — use the explicit numeric index matching the new array length).

No other UI, no other dialogs, no styling changes. No backend changes — exports happen client-side; the importer change is local to `parseChecklists`.