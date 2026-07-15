## Goal

Rewire the orb gestures and two menu slots so:

- **Single tap on Orby** → open the full-document editor (what double-tap does today).
- **Swipe left on Orby** → open the menu grid (what single tap does today).
- **Slot 11 (menu)** → 💬 Chat — opens the most recent thread (no new thread created). This behavior already works, just make the wiring explicit.
- **Slot 13 (menu)** → 💡 New Idea — opens the composer that swipe-left used to open.

Long-press on Orby (open chat) and all other swipes (up/down/right) stay exactly as they are.

## Changes — all in `src/routes/_authenticated/app.tsx`

### 1. Orb gesture wiring (lines ~1042–1058)

In the `useOrbGestures` call:

- `onTap: onSwipeLeft` → change to `onTap: onDoubleTap` (single tap now opens the editor).
- Inside `onSwipe`, `dir === "left"` currently calls `openNewIdea()` → change to `setMenuOpen(true)`.
- Remove the now-unused `onSwipeLeft` const on line 1014 (menu open is inlined in the swipe handler).

Spacebar keyboard shortcut (lines 1060–1083) is left as-is — space still triggers new idea / edit like before, since it's a keyboard convenience, not the orb.

### 2. Slot 11 → Chat (opens most recent thread)

In the `slots` `useMemo` (line 1897):

```text
filled[10] = grid[20];  →  filled[10] = grid[2];   // 11 Chat (most recent thread)
```

`grid[2]` is already `{ e: "💬", t: "Chat", fn: () => { setMenuOpen(false); setChatOpen(true); } }`, and `ChatDialog` already restores the most-recent thread from `localStorage` on open — no new thread is created. Nothing else to change here.

### 3. Slot 13 → 💡 New Idea

In the `slots` `useMemo` (line 1899):

```text
filled[12] = grid[2];  →  filled[12] = { e: "💡", t: "New idea", fn: () => { setMenuOpen(false); openNewIdea(); } };
```

Inlining the slot (rather than repointing to a `grid[...]` entry) keeps the `grid` array's numeric indices untouched, so no other slot mappings shift.

### 4. Leftover chat duplicates in `grid`

`grid[3]` and `grid[4]` are inert duplicate Chat entries kept only to preserve grid indices (comment on line 1727). They stay as-is; nothing references them after this change either, so leaving them avoids any index drift risk.

## What is intentionally NOT changing

- Long-press on Orby → still opens Chat on the most recent thread.
- Swipe up / down / right on Orby → unchanged (Next / Menu-ish / Favorites).
- Chat button in the header of ChatDialog, thread drawer, capability toggles → unchanged.
- Emoji filter in doc search, plan engine, speech logic, aurora, slot 14 Recent docs, slot 24 Swap slot → all untouched.
- `openNewIdea` implementation itself is unchanged — it just gets called from Slot 13 instead of from swipe-left.

## Verification

1. Typecheck.
2. Manual on mobile viewport:
   - Single tap orb → full-doc editor opens (no menu).
   - Swipe left on orb → menu opens (no composer).
   - Long-press orb → chat opens on the most recent thread.
   - Menu Slot 11 (💬 Chat) → opens chat, most recent thread, no new thread created.
   - Menu Slot 13 (💡 New idea) → composer opens exactly like the old swipe-left did.
   - Swipe up/down/right on orb still do Next / Menu / Favorites resume.
