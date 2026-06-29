## Goal
When the user pins a new document from the slot 19 pin picker, it should not only pin it (current behavior) but also immediately open that document — switching to it and triggering the normal speech for whatever sentence the user was on in that doc.

## The change (one file: `src/routes/_authenticated/app.tsx`)

### 1. Make the open helper accept a specific doc id
`openPinnedDocument` (lines ~853-901) currently reads the pinned id from `pinnedDocId` state. Right after pinning, that state hasn't updated yet (stale closure), so it can't be reused as-is.

Refactor it so the target id is a parameter:
- Change signature to `openPinnedDocument(targetId?: string)` and use `const docId = targetId ?? pinnedDocId;` then operate on `docId` everywhere (existence check, fetches, query-cache updates, `setActiveDocId`, speech).
- Existing callers (slot 19 button at line ~1877/2193) keep calling `openPinnedDocument()` with no argument — behavior unchanged.

### 2. Open the doc when pinning from the picker
In the pin picker list `onClick` (lines ~2302-2306), after pinning:

```
onClick={() => {
  void savePinnedDoc(d.id);
  setPinPickerOpen(false);
  toast.success(`Pinned "${d.title || "Untitled"}"`);
  void openPinnedDocument(d.id);   // <- new: open it immediately
}}
```

This switches the active document to the newly pinned one and starts speech on the sentence the user last left off on in that doc — exactly like pressing the slot 19 open action.

## Notes
- No backend/database changes.
- The lock guard on the slot 19 invisible button stays as-is; this only affects pinning from the picker.