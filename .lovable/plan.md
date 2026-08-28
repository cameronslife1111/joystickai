# Fix: can't select the new voices

## What's wrong

The database still only accepts the original four voices. I confirmed the rule on `user_preferences`:

```text
tts_voice must be NULL or one of: Charon, Fenrir, Kore, Aoede
```

When we expanded the picker to 20 US voices, the app started saving names like `Sulafat` or `Puck`, which the database rejects — that's the exact error in your screenshot. Nothing is wrong with the picker itself; the saved value is being blocked.

## The fix

1. Replace that rule so it accepts all 20 voices currently offered in the Sound menu (10 female, 10 male), still allowing empty (use default).
2. Keep the app's voice list as the single source of truth, so the allowed set matches the menu exactly.

## Technical detail

One migration on `public.user_preferences`: drop `user_preferences_tts_voice_allowed` and re-add it with the full voice list from `src/lib/tts-voices.ts`. No table, column, or type changes, no data loss — existing saved voices stay valid.

## Verification

Open Sound settings, pick several of the new voices (including one from each group), confirm each saves with no error, preview plays, and the choice sticks after a reload.
