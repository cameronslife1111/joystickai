Change the invisible button to the left of the Orbi orb so it opens the pinned document (same behavior as the Pinned doc menu button in slot 19) instead of toggling the list lock.

### What to change
**File: `src/routes/_authenticated/app.tsx`**

Locate the invisible left-side button around line 2189-2194:

```
<button
  type="button"
  onClick={() => toggleListLock(false)}
  className="absolute top-1/2 right-full mr-4 h-2/3 w-[22vw] max-w-[120px] -translate-y-1/2 opacity-0"
  aria-label="Toggle list lock"
/>
```

Replace its `onClick` handler with:
1. If `lockFavorites` is true, show the "List is locked" toast and return early.
2. Otherwise, call `openPinnedDocument()`.

Update `aria-label` to `"Open pinned document"`.

### Why only this change
- Slot 22 (Lock/unlock list cycling) stays exactly as-is.
- The pinned document logic (`openPinnedDocument`) already exists and handles the "no document pinned" and "not found" cases with toasts.
- The lock check (`lockFavorites`) is the same guard used by the Pinned doc menu button.