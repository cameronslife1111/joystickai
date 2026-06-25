## Goal

Give the invisible button on the **left** side of Orby a new action: toggle the list lock/unlock (the same action as the "List unlocked / List locked" button in slot 22). The **right** side keeps repeating the current sentence. Works on mobile and desktop.

## Current behavior

In `src/routes/_authenticated/app.tsx` there are two invisible buttons flanking the orb (around line 2184). Both currently do the same thing — `onClick` reads `currentSentence?.content` and calls `speak(...)`:

- Left button: `className="... right-full ..."` → repeats sentence
- Right button: `className="... left-full ..."` → repeats sentence

The lock toggle lives in the grid menu (slot 22, line ~1879). Its action is:

```text
const next = !lockFavorites;
saveLockFavorites(next);
saveLockedDoc(next ? activeDocId : null);
toast.success(next ? "...locked" : "...unlocked");
```

Pressing it again flips `lockFavorites`, so it toggles lock ↔ unlock exactly as requested.

## Change

Update only the **left** invisible button's `onClick` so it runs the lock-toggle logic instead of repeating the sentence. The right button is left untouched (still repeats).

To avoid duplicating logic, extract the toggle into a small reusable handler (e.g. `toggleListLock`) and call it from both the slot-22 menu button and the left invisible button. The handler reads the current `lockFavorites` value, flips it, persists via `saveLockFavorites` / `saveLockedDoc`, and shows the toast.

Also update the left button's `aria-label` from "Repeat sentence" to something like "Toggle list lock" for accessibility/clarity.

Since this is a standard `onClick` on a `<button>`, it works for both touch (mobile) and mouse (desktop) automatically.

## Files touched

- `src/routes/_authenticated/app.tsx` — add `toggleListLock` handler, point slot-22 button and the left invisible button at it, update left button `aria-label`.

No backend, schema, or save/load logic changes — it reuses the existing lock persistence already used by the menu.