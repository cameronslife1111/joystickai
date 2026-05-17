## Goal

Add a single **mute / unmute** toggle to the side menu that fully disables the web speech function while muted (no `speechSynthesis.speak()` calls at all — important so iOS doesn't audio-duck). The state persists in `user_preferences` so it survives reloads.

## DB

Add one column to `public.user_preferences`:

```sql
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;
```

No new policies needed (existing own-row RLS covers it). No new table.

## App changes (`src/routes/_authenticated/app.tsx`)

### 1. Extend the prefs query

Update the `user_preferences` query to also select `muted`:

```ts
.select("favorites, muted")
```

Return `{ favorites, muted: !!data?.muted }` from `queryFn`. Expose `const muted = prefs?.muted ?? false;`.

### 2. Persist the toggle

Add `saveMuted(next: boolean)`:
- Optimistically update the `["user_preferences"]` cache with `{ ...prev, muted: next }`.
- `supabase.from("user_preferences").upsert({ user_id, muted: next, favorites: favorites as any }, { onConflict: "user_id" })`.
- On mute → call `window.speechSynthesis.cancel()` once so any in-flight utterance stops immediately.

### 3. Gate `speak()` at the source

Read `muted` via a `mutedRef` (updated in a small `useEffect` from `prefs?.muted`) so the existing `useCallback` for `speak()` doesn't need to be re-created on every change. At the very top of `speak()`:

```ts
if (mutedRef.current) return;
```

Reason for the early return (not just turning volume down): on iOS Safari/Chrome, even a muted `SpeechSynthesisUtterance` activates the audio session and ducks background audio. Never invoking `.speak()` is the only reliable way to avoid that.

`claimSpeech()` stays as-is — calling `cancel()` while muted is harmless and keeps the token state consistent for when the user unmutes mid-session.

### 4. Menu button

The menu items array currently includes Theme, Favorites, etc. (line ~568). Add one more entry — single button whose emoji and label reflect the current state:

- Muted: `🔇` label "Sound off"
- Unmuted: `🔊` label "Sound on"

Clicking it calls `saveMuted(!muted)` and closes the menu (matches the existing menu-item behavior). Place it near the Theme entry since both are global app preferences.

The menu items array is memoized on `[theme, docs, activeDoc, favorites, saveFavorites, qc, navigate]` — add `muted` and `saveMuted` to that dependency list.

## What does NOT change

- Long-press voice capture (`SpeechRecognition`) is input, not output — it stays unaffected by the mute toggle.
- Toast notifications, gestures, and all sentence/doc behavior are untouched.
- No new dependencies.

## Files touched

- New migration adding `muted` to `user_preferences`.
- `src/routes/_authenticated/app.tsx` — query update, `mutedRef`, `speak()` early return, `saveMuted`, and one new menu item.
