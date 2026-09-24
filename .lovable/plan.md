# 300 favorites slots, saved favorites groups, and planner-made groups

## What you will see

**1. 300 slots instead of 50**
- The Favorites screen (opened from slot 16 or 24) shows 300 slots. Your current 50 stay exactly where they are; slots 51-300 start empty.
- The count reads "12 / 300 filled". "Clear all slots", long press to step, tap to pick, and orb cycling all work across the full 300.

**2. Save and load favorites groups**
- A new "Groups" button sits next to "Clear all slots".
- It opens a small sheet with:
  - **Save current as group** — type a name (e.g. "Morning routine"); saves all 300 slots in their exact order. Saving with an existing name asks to overwrite.
  - **A list of saved groups** — each shows its name and how many documents it holds. Tap **Load** to replace your current slots with that group exactly as saved. Also **Rename** and **Delete**.
- Loading respects the favorites lock (shows the usual "List is locked" message).
- Documents deleted since a group was saved simply become empty slots on load.

**3. The chat planner can build groups**
- When a chat has Document editing turned on, a multi-step plan can create a favorites group from your description, e.g. "Make a group called Album Work: the DaVinci notes first, then Lyrics, then Mix checklist."
- Orby matches the documents you name loosely, puts them in the order you said, saves the group, and reports which documents it used (and any it couldn't find).
- It can also load a saved group into your slots if you ask it to ("…and load it now"); otherwise it only saves it.

## Technical notes

- Slot count: replace the hard-coded `50` in `src/routes/_authenticated/app.tsx` (padding, clear-all, grid render, count label, pickers) with a shared `FAVORITE_SLOTS = 300` constant. Grid stays virtualization-free (300 small buttons is fine) but scrolls inside the overlay.
- New table `favorite_groups` (id, user_id, name, slots jsonb array of doc id | null, created_at, updated_at, unique(user_id, name)), with GRANTs to authenticated/service_role, RLS scoped to `auth.uid() = user_id`.
- Groups UI: new `FavoriteGroupsSheet` component using the browser client; load calls the existing `saveFavorites(padded)`; lock guard reused.
- Planner: in `supabase/functions/_shared/tools.ts` add `create_favorites_group` (name, ordered document names or ids, optional `load_now`) and `list_favorites_groups` to the `document_editing` group. Handlers in `supabase/functions/plan-step/index.ts` resolve documents with the existing fuzzy document lookup, scoped by `user_id`, upsert the group, and when `load_now` is set write `user_preferences.favorites` (skipping if favorites are locked). Short guidance line in `plan-compose`. Redeploy plan-step and plan-compose.
