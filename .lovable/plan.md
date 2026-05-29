Change the `replaceMatching` state default from `false` to `true` in the favorites slot picker, and update the `closePicker` reset to also default back to `true`. This ensures every time the user opens a slot in the favorites editor, "Replace all matching slots" is automatically selected.

**File:** `src/routes/_authenticated/app.tsx`

**Changes:**
1. Line 46 — change `const [replaceMatching, setReplaceMatching] = useState(false);` to `useState(true);`
2. Line 1775 — inside `closePicker`, change `setReplaceMatching(false);` to `setReplaceMatching(true);`