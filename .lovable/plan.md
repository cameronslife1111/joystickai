## Add "Copy" Button to Rename Document Popup

### Goal
Add a copy button to the Rename Document popup in the Media Gallery so users can easily copy the current document/asset title to their clipboard.

### Changes
1. **Import `Copy` icon** from `lucide-react` in `src/routes/_authenticated/media.tsx`.
2. **Add a Copy button** inside the rename dialog's button row (between Cancel and Save).
   - On click: copy `renameText` to clipboard via `navigator.clipboard.writeText()`.
   - Show a `toast.success("Copied to clipboard")` confirmation.
   - Use the `Copy` Lucide icon + "Copy" label, styled to match existing buttons.
3. **Keep existing behavior** intact: Cancel closes the dialog, Save triggers `handleRename()`.

### File touched
- `src/routes/_authenticated/media.tsx` (rename dialog around line 730)

No new dependencies, no backend changes.