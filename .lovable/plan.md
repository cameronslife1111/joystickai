# Move composer/edit floating buttons into one emoji row above the orbs

## What we're changing

Consolidate all composer and editor action controls into a single horizontal row of circular emoji-only buttons that sits just above the orb cluster — where the existing pill-shaped action buttons already appear. This removes the right-side floating 🤖/🏆/🔴 buttons that cover the text while typing.

The change applies to three modes:

1. **New Idea composer** (`composing`)
2. **Full document editor** (`editing`)
3. **Quick-edit this sentence** (`quickEditing`)

### Emoji mapping (default choices; swap if you prefer others)

| Action        | Emoji |
|---------------|-------|
| Cancel        | ❌    |
| Add to current| ➕    |
| Done          | ✅    |
| Send to…      | 📤    |
| Jump to top   | ⬆️    |
| Copy          | 📋    |
| Duplicate     | 📑    |
| Trophy insert | 🏆    |
| Ask Orby      | 🤖    |
| Voice input   | 🔴 / ⬛️ |

## Files to change

- `src/routes/_authenticated/app.tsx`
  - Remove the fixed `right-[4vw]` floating buttons for composer (🤖, 🏆, 🔴) and editor (🏆, 🔴).
  - Replace the existing pill-button rows for `composing`, `editing`, and `quickEditing` with one shared circular-emoji row rendered in the same bottom area, above `OrbCluster`.
  - Keep all existing click handlers, disabled states, `aria-label`, `title`, and the `onPointerDown` behavior that keeps the textarea focused for 🏆 and 🔴.
  - Preserve the 🤖 spinner state while Ask Orby is thinking.
  - Preserve the 🔴/⬛️/… recording state for voice input.
  - For `editing`, keep the bottom fixed bar but convert its two pills (Done, Jump to top) into circular emojis and merge them with 🏆 and 🔴 in the same row.
  - For `quickEditing`, convert Cancel/Copy/Duplicate/Done pills into circular emojis in the same row.

## Out of scope

- No change to the orb cluster layout, colors, or gestures.
- No change to what any button does — only where and how it looks.
- No change to the linked-chat pill that appears above the orbs in normal reading mode.

## Verification

- `bunx tsgo --noEmit` passes.
- Build log shows no errors.
- In the preview: open New Idea, full editor, and quick-edit; confirm all action buttons are in one horizontal emoji row above the orbs and the right-side floating buttons are gone.
