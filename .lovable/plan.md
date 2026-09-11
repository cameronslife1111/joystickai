# Keyboard letter shortcuts while reading sentences

Add single-letter shortcuts that work only in the same situation the arrow keys already work: when you are moving through sentences and not typing anywhere.

## Shortcuts

| Key | Action |
| --- | --- |
| C | Opens Chat (the chat list, same as the chat button) |
| G | Opens the Media Gallery |
| M | Opens the Move sentence popup |
| J | Opens the Jump to popup |
| S | Opens Swap slot |
| L | Opens Link documents for the current sentence |
| I | Opens New idea |
| D | Deletes the current sentence only, with the "Sentence deleted" toast and its Undo |

Lower or upper case both work.

## When they do nothing

Exactly the same conditions the arrow keys already respect, so nothing fires while you type:

- Any text box, text area, dropdown, or editable area has focus.
- Edit mode, quick-edit, or New idea composer is open.
- Any popup or full-screen view is open (menu, favorites, jump, move, search, recent, chat, plans, rename, new doc, delete doc, send, link picker).
- Any modifier key is held (Command, Control, Option, Shift), so browser shortcuts keep working.

L also does nothing when there is no sentence selected, matching the button.

## Technical detail

In `src/routes/_authenticated/app.tsx`, add one `useEffect` keydown listener next to the existing arrow-key and spacebar listeners, reusing their guard sequence: modifier check, `busyRef.current` check, and the `INPUT`/`TEXTAREA`/`SELECT`/`isContentEditable` target check. Map `e.key.toLowerCase()` to the existing handlers already used by the menu grid — `setChatStartInList`/`setChatOpen`, `navigate({ to: "/media" })`, `setMoveOpen`, `setJumpOpen`, the swap-slot sequence (`setReplaceMatching`, `setPickerQuery("🟢")`, `setFavoritesOpen`, `setPickerSlot(0)`), `setLinkPickerOpen`, `openNewIdea`, and `deleteCurrent` — then `preventDefault()`. No new state, no changes to the buttons or handlers themselves.

Verify with a typecheck plus an authenticated Playwright pass: each letter from the reading screen, and each letter typed into the editor and the chat composer to confirm nothing triggers.
