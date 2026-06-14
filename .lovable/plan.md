## Goal
Add two more options to the slot 12 "Jump to" overlay: jump back 25 and jump ahead 25.

## Change (in `src/routes/_authenticated/app.tsx`)
In the Jump-to overlay option list (~lines 2558–2564), add two entries to the existing array:
- `{ label: "⏪  Jump back 25", target: currentIdx - 25 }` — placed before "Jump back 10"
- `{ label: "⏩  Jump ahead 25", target: currentIdx + 25 }` — placed after "Jump ahead 10"

The existing `jumpTo(target)` already clamps the target index, so no other logic changes are needed.

Resulting order:
```text
⤒  Jump to top
⏪  Jump back 25
⏪  Jump back 10
◀  Jump back 5
▶  Jump ahead 5
⏩  Jump ahead 10
⏩  Jump ahead 25
⤓  Jump to end
```

## Verification
Open the menu → slot 12 (Jump to) and confirm the two new buttons appear and navigate ±25 sentences (clamped at start/end).